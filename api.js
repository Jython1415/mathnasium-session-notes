// API interaction, caching, and batch processing logic

class SessionNotesAPI {
  constructor() {
    this.lastCachePrime = null;
    this.cacheStats = { hits: 0, misses: 0, savings: 0 };
    this.currentConcurrency = CONFIG.INITIAL_CONCURRENCY;
  }

  // Generate unique 5-character lowercase alphanumeric ID (git-style)
  generateUniqueId(existingIds) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    let id;
    do {
      id = Array.from({length: 5}, () =>
        chars[Math.floor(Math.random() * chars.length)]
      ).join('');
    } while (existingIds.has(id));
    return id;
  }

  // Assign unique IDs to all rows upfront
  assignUniqueIds(jsonData) {
    const existingIds = new Set();
    return jsonData.map((row, idx) => {
      const unique_id = this.generateUniqueId(existingIds);
      existingIds.add(unique_id);
      return {
        unique_id: unique_id,
        data: row,              // Original row data
        originalIndex: idx,     // For looking up in originalData array
        retryCount: 0           // Track retry attempts
      };
    });
  }

  // Convert enriched rows to markdown format with unique IDs
  convertToMarkdownKV(enrichedRows) {
    const fields = [
      'Date',
      'Student Name',
      'Session Start',
      'Session End',
      'Instructors',
      'Schoolwork Description',
      'Session Summary Notes',
      'Student Notes',
      'Internal Notes',
      'Notes from Center Director',
      'LP Assignment'
    ];

    const blocks = enrichedRows.map(({unique_id, data}) => {
      const header = `--- Row ID: ${unique_id} ---`;
      const content = fields.map(field => {
        const value = data[field] !== undefined && data[field] !== null ? data[field] : '';
        return `${field}: ${value}`;
      }).join('\n');
      return `${header}\n${content}`;
    });

    return blocks.join('\n\n');
  }

  // Prime the cache with system prompt
  async primeCache() {
    console.log('[CACHE] Priming cache');

    try {
      const response = await fetch(CONFIG.API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CONFIG.MODEL,
          max_tokens: 16,
          stream: false,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" }
            }
          ],
          messages: [
            {
              role: "user",
              content: "Cache priming request - please respond with OK"
            }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const usage = data.usage || {};
        console.log('[DEBUG] Full usage object:', JSON.stringify(usage, null, 2));
        console.log('[CACHE] Prime complete. Tokens cached:', usage.cache_creation_input_tokens || 0);
        this.lastCachePrime = Date.now();
      } else {
        console.warn('[CACHE] Prime failed with status:', response.status);
      }
    } catch (err) {
      console.warn('[CACHE] Prime failed:', err.message);
    }
  }

  // Check if cache needs re-priming
  isCacheStale() {
    if (!this.lastCachePrime) return true;
    const cacheAge = Date.now() - this.lastCachePrime;
    return cacheAge > CONFIG.CACHE_TTL_MS;
  }

  // Process a single batch with retry logic
  async processBatch(batch, batchNum, totalBatches) {
    const retryWithBackoff = async (attempt = 0) => {
      try {
        const markdownKV = this.convertToMarkdownKV(batch);
        console.log('[BATCH] Processing batch', batchNum + 1, '/', totalBatches, '(' + batch.length, 'rows)');

        const response = await fetch(CONFIG.API_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: CONFIG.MODEL,
            max_tokens: 16000,
            stream: false,
            system: [
              {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" }
              }
            ],
            messages: [
              {
                role: "user",
                content: `Analyze these session records:\n\n<session_data>\n${markdownKV}\n</session_data>`
              }
            ]
          })
        });

        // Handle rate limits
        if (response.status === 429) {
          if (attempt < CONFIG.MAX_RETRIES) {
            const backoffTime = Math.pow(CONFIG.RETRY_BACKOFF_BASE, attempt) * 1000 + Math.random() * CONFIG.RETRY_JITTER_MS;
            console.warn('[RETRY] Batch', batchNum + 1, 'hit rate limit. Waiting', Math.floor(backoffTime), 'ms...');

            // Reduce concurrency
            if (this.currentConcurrency > CONFIG.MIN_CONCURRENCY) {
              this.currentConcurrency = Math.max(CONFIG.MIN_CONCURRENCY, Math.floor(this.currentConcurrency * 0.5));
              console.log('[CONCURRENCY] Reduced to', this.currentConcurrency);
            }

            await new Promise(resolve => setTimeout(resolve, backoffTime));
            return retryWithBackoff(attempt + 1);
          } else {
            throw new Error('RATE_LIMIT: Maximum retries reached. Too many requests.');
          }
        }

        const responseText = await response.text();

        if (!response.ok) {
          let errorMessage = `API request failed with status ${response.status}`;
          try {
            const errorData = JSON.parse(responseText);
            if (errorData.error?.message) {
              errorMessage = errorData.error.message;
            }
          } catch {
            errorMessage = `${errorMessage}. Response: ${responseText.substring(0, 200)}`;
          }
          const errorPrefix = CONFIG.HTTP_ERROR_PREFIXES[response.status] || 'HTTP_ERROR';
          throw new Error(`${errorPrefix}: ${errorMessage}`);
        }

        const data = JSON.parse(responseText);

        // Track cache stats
        const usage = data.usage || {};
        console.log('[DEBUG] Batch', batchNum + 1, 'usage:', JSON.stringify(usage, null, 2));

        const cacheHits = usage.cache_read_input_tokens || 0;
        const cacheMisses = usage.cache_creation_input_tokens || 0;
        const savings = (cacheHits * CONFIG.COSTS.HAIKU_INPUT - cacheHits * CONFIG.COSTS.HAIKU_CACHE_READ) / 1000000;

        this.cacheStats.hits += cacheHits;
        this.cacheStats.misses += cacheMisses;
        this.cacheStats.savings += savings;

        console.log('[CACHE] Batch', batchNum + 1, '- Hits:', cacheHits, '| Misses:', cacheMisses, '| Savings: $' + savings.toFixed(4));

        if (!data.content?.[0]?.text) {
          throw new Error('STRUCTURE_ERROR: Unexpected API response structure.');
        }

        let reviewResult = data.content[0].text;
        reviewResult = reviewResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const reviewData = JSON.parse(reviewResult);

        if (!reviewData.reviews || !Array.isArray(reviewData.reviews)) {
          throw new Error('STRUCTURE_ERROR: Review data missing "reviews" array.');
        }

        console.log('[SUCCESS] Batch', batchNum + 1, 'complete:', reviewData.reviews.length, 'reviews');

        return reviewData.reviews;

      } catch (err) {
        if (attempt < CONFIG.MAX_RETRIES && !err.message.includes('PARSE_ERROR') && !err.message.includes('STRUCTURE_ERROR')) {
          const backoffTime = Math.pow(CONFIG.RETRY_BACKOFF_BASE, attempt) * 1000 + Math.random() * CONFIG.RETRY_JITTER_MS;
          console.warn('[RETRY] Batch', batchNum + 1, 'failed:', err.message, '. Retrying in', Math.floor(backoffTime), 'ms...');
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          return retryWithBackoff(attempt + 1);
        }
        throw err;
      }
    };

    return retryWithBackoff();
  }

  // Process entire file with parallel batching
  async processFile(jsonData, progressCallback = null) {
    console.log('[PROCESS] Starting file processing for', jsonData.length, 'rows');

    // Reset stats
    this.cacheStats = { hits: 0, misses: 0, savings: 0 };

    // Check if cache needs re-priming
    if (this.isCacheStale()) {
      const cacheAge = this.lastCachePrime ? Math.floor((Date.now() - this.lastCachePrime) / 1000) : 'never';
      console.log('[CACHE] Cache is stale (last prime:', cacheAge, 's ago). Re-priming...');
      await this.primeCache();
    } else {
      const cacheAge = Math.floor((Date.now() - this.lastCachePrime) / 1000);
      console.log('[CACHE] Cache is fresh (' + cacheAge + 's old)');
    }

    // Split into batches
    const batches = [];
    for (let i = 0; i < jsonData.length; i += CONFIG.BATCH_SIZE) {
      batches.push(jsonData.slice(i, i + CONFIG.BATCH_SIZE));
    }
    console.log('[BATCH] Split into', batches.length, 'batches of ~' + CONFIG.BATCH_SIZE + ' rows');

    // Process batches in parallel with dynamic concurrency
    const allReviews = [];
    let batchIndex = 0;
    const failedBatches = [];

    while (batchIndex < batches.length) {
      const batchesToProcess = [];

      // Add new batches up to concurrency limit
      while (batchesToProcess.length < this.currentConcurrency && batchIndex < batches.length) {
        const currentBatchIndex = batchIndex;
        batchesToProcess.push(this.processBatch(batches[currentBatchIndex], currentBatchIndex, batches.length));
        batchIndex++;
      }

      // Wait for current batch to complete
      const results = await Promise.allSettled(batchesToProcess);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allReviews.push(...result.value);
          if (progressCallback) {
            progressCallback(allReviews.length, jsonData.length);
          }
        } else {
          console.error('[ERROR] Batch failed permanently:', result.reason.message);
          failedBatches.push(result.reason);
        }
      }

      // Gradually increase concurrency on success
      if (results.every(r => r.status === 'fulfilled') && this.currentConcurrency < CONFIG.MAX_CONCURRENCY) {
        this.currentConcurrency = Math.min(CONFIG.MAX_CONCURRENCY, this.currentConcurrency + 1);
        console.log('[CONCURRENCY] Increased to', this.currentConcurrency);
      }
    }

    // Check if we got all reviews
    if (failedBatches.length > 0) {
      throw new Error('PARTIAL_FAILURE: Some batches failed to process. ' + failedBatches.length + ' batch(es) failed.');
    }

    console.log('[SUCCESS] All batches complete. Total reviews:', allReviews.length);
    console.log('[CACHE] Session totals - Hits:', this.cacheStats.hits, '| Misses:', this.cacheStats.misses, '| Total savings: $' + this.cacheStats.savings.toFixed(4));

    return allReviews;
  }
}

// Create singleton instance
const api = new SessionNotesAPI();
