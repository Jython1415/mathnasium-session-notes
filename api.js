// API interaction, caching, and batch processing logic

class SessionNotesAPI {
  constructor() {
    this.lastCachePrime = null;
    this.cacheStats = { hits: 0, misses: 0 };
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

  // Process a single batch and return results with metadata
  async processBatch(enrichedRows, batchNum) {
    const retryWithBackoff = async (attempt = 0) => {
      try {
        const markdownKV = this.convertToMarkdownKV(enrichedRows);
        const requestedIds = enrichedRows.map(r => r.unique_id);

        console.log('[BATCH]', batchNum, 'Processing', enrichedRows.length, 'rows, IDs:', requestedIds.join(','));

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
            console.warn('[RETRY] Batch', batchNum, 'hit rate limit. Waiting', Math.floor(backoffTime), 'ms...');

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
        const cacheHits = usage.cache_read_input_tokens || 0;
        const cacheMisses = usage.cache_creation_input_tokens || 0;

        this.cacheStats.hits += cacheHits;
        this.cacheStats.misses += cacheMisses;

        console.log('[CACHE] Batch', batchNum, '- Hits:', cacheHits, '| Misses:', cacheMisses);

        if (!data.content?.[0]?.text) {
          throw new Error('STRUCTURE_ERROR: Unexpected API response structure.');
        }

        let reviewResult = data.content[0].text;
        reviewResult = reviewResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const reviewData = JSON.parse(reviewResult);

        if (!reviewData.reviews || !Array.isArray(reviewData.reviews)) {
          throw new Error('STRUCTURE_ERROR: Review data missing "reviews" array.');
        }

        // Validate: filter to only reviews matching requested IDs and remove duplicates
        const requestedIdsSet = new Set(requestedIds);
        const seenIds = new Set();
        const validReviews = [];
        const invalidIds = [];
        const duplicateIds = [];

        for (const review of reviewData.reviews) {
          const id = review.unique_id;

          // Check if this ID was requested
          if (!requestedIdsSet.has(id)) {
            invalidIds.push(id);
            continue;
          }

          // Check if we've already seen this ID (duplicate)
          if (seenIds.has(id)) {
            duplicateIds.push(id);
            continue;
          }

          // Valid review - enrich with originalIndex
          const matchingRow = enrichedRows.find(r => r.unique_id === id);
          if (matchingRow) {
            review.originalIndex = matchingRow.originalIndex;
            validReviews.push(review);
            seenIds.add(id);
          }
        }

        // Identify missing IDs
        const missingIds = requestedIds.filter(id => !seenIds.has(id));

        // Log warnings for invalid/duplicate IDs
        if (invalidIds.length > 0) {
          console.warn('[WARNING] Batch', batchNum, 'returned', invalidIds.length, 'unrequested IDs:', invalidIds.join(','));
        }
        if (duplicateIds.length > 0) {
          console.warn('[WARNING] Batch', batchNum, 'returned', duplicateIds.length, 'duplicate IDs:', duplicateIds.join(','));
        }

        console.log('[SUCCESS] Batch', batchNum, 'complete:', validReviews.length, '/', requestedIds.length, 'reviews');
        if (missingIds.length > 0) {
          console.warn('[WARNING] Batch', batchNum, 'missing', missingIds.length, 'IDs:', missingIds.join(','));
        }

        return {
          reviews: validReviews,
          requestedIds: requestedIds,
          receivedIds: Array.from(seenIds),
          missingIds: missingIds
        };

      } catch (err) {
        if (attempt < CONFIG.MAX_RETRIES && !err.message.includes('PARSE_ERROR') && !err.message.includes('STRUCTURE_ERROR')) {
          const backoffTime = Math.pow(CONFIG.RETRY_BACKOFF_BASE, attempt) * 1000 + Math.random() * CONFIG.RETRY_JITTER_MS;
          console.warn('[RETRY] Batch', batchNum, 'failed:', err.message, '. Retrying in', Math.floor(backoffTime), 'ms...');
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          return retryWithBackoff(attempt + 1);
        }
        throw err;
      }
    };

    return retryWithBackoff();
  }

  // Process entire file with queue-based row processing
  async processFile(jsonData, progressCallback = null) {
    console.log('[PROCESS] Starting file processing for', jsonData.length, 'rows');

    // Reset stats
    this.cacheStats = { hits: 0, misses: 0 };

    // Check if cache needs re-priming
    if (this.isCacheStale()) {
      const cacheAge = this.lastCachePrime ? Math.floor((Date.now() - this.lastCachePrime) / 1000) : 'never';
      console.log('[CACHE] Cache is stale (last prime:', cacheAge, 's ago). Re-priming...');
      await this.primeCache();
    } else {
      const cacheAge = Math.floor((Date.now() - this.lastCachePrime) / 1000);
      console.log('[CACHE] Cache is fresh (' + cacheAge + 's old)');
    }

    // Assign unique IDs to all rows upfront
    const allEnrichedRows = this.assignUniqueIds(jsonData);
    console.log('[QUEUE] Created queue with', allEnrichedRows.length, 'rows');

    // Create row queue and tracking structures
    const rowQueue = [...allEnrichedRows]; // Rows waiting to be processed
    const rowMap = new Map(allEnrichedRows.map(r => [r.unique_id, r])); // ID -> enriched row
    const completedReviews = []; // Successfully processed reviews
    const failedRows = []; // Rows that failed after max retries
    let batchCounter = 0;

    // Process queue until empty
    while (rowQueue.length > 0 || failedRows.length < rowMap.size - completedReviews.length) {
      const batchesToProcess = [];

      // Create batches from queue up to concurrency limit
      for (let i = 0; i < this.currentConcurrency && rowQueue.length > 0; i++) {
        const batchSize = Math.min(CONFIG.BATCH_SIZE, rowQueue.length);
        const batch = rowQueue.splice(0, batchSize);
        batchCounter++;
        batchesToProcess.push({
          batchNum: batchCounter,
          rows: batch,
          promise: this.processBatch(batch, batchCounter)
        });
      }

      if (batchesToProcess.length === 0) {
        break; // Nothing left to process
      }

      // Wait for current wave of batches to complete
      const results = await Promise.allSettled(batchesToProcess.map(b => b.promise));

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const batchInfo = batchesToProcess[i];

        if (result.status === 'fulfilled') {
          const { reviews, missingIds } = result.value;

          // Add successful reviews to completed list
          completedReviews.push(...reviews);

          // Re-queue missing rows (if under retry limit)
          for (const id of missingIds) {
            const row = rowMap.get(id);
            if (row) {
              row.retryCount++;
              if (row.retryCount <= CONFIG.MAX_RETRIES) {
                console.log('[RETRY] Re-queuing row', id, '(attempt', row.retryCount + 1, '/', CONFIG.MAX_RETRIES + 1, ')');
                rowQueue.push(row);
              } else {
                console.error('[FAILED] Row', id, 'exceeded max retries');
                failedRows.push(row);
              }
            }
          }

          // Update progress
          if (progressCallback) {
            progressCallback(completedReviews.length + failedRows.length, allEnrichedRows.length);
          }

          // Gradually increase concurrency on success
          if (missingIds.length === 0 && this.currentConcurrency < CONFIG.MAX_CONCURRENCY) {
            this.currentConcurrency = Math.min(CONFIG.MAX_CONCURRENCY, this.currentConcurrency + 1);
            console.log('[CONCURRENCY] Increased to', this.currentConcurrency);
          }

        } else {
          // Entire batch failed - re-queue all rows from this batch
          console.error('[ERROR] Batch', batchInfo.batchNum, 'failed:', result.reason.message);

          for (const row of batchInfo.rows) {
            row.retryCount++;
            if (row.retryCount <= CONFIG.MAX_RETRIES) {
              console.log('[RETRY] Re-queuing row', row.unique_id, 'from failed batch (attempt', row.retryCount + 1, '/', CONFIG.MAX_RETRIES + 1, ')');
              rowQueue.push(row);
            } else {
              console.error('[FAILED] Row', row.unique_id, 'exceeded max retries');
              failedRows.push(row);
            }
          }

          // Reduce concurrency on failure
          if (this.currentConcurrency > CONFIG.MIN_CONCURRENCY) {
            this.currentConcurrency = Math.max(CONFIG.MIN_CONCURRENCY, Math.floor(this.currentConcurrency * 0.5));
            console.log('[CONCURRENCY] Reduced to', this.currentConcurrency);
          }
        }
      }
    }

    console.log('[SUCCESS] Processing complete:', completedReviews.length, 'reviews,', failedRows.length, 'failed');
    console.log('[CACHE] Session totals - Hits:', this.cacheStats.hits, '| Misses:', this.cacheStats.misses);

    return {
      reviews: completedReviews,
      failedRows: failedRows,
      totalRows: allEnrichedRows.length,
      successCount: completedReviews.length
    };
  }
}

// Create singleton instance
const api = new SessionNotesAPI();
