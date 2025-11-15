const { useState, useEffect } = React;

function SessionNotesReviewerEnhanced() {
  // File and processing state
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [originalData, setOriginalData] = useState([]);
  const [error, setError] = useState('');

  // UI state
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [feedback, setFeedback] = useState({});
  const [isDragging, setIsDragging] = useState(false);

  // Progress tracking
  const [processedRows, setProcessedRows] = useState(0);
  const [totalRows, setTotalRows] = useState(0);

  // Prime cache on page load
  useEffect(() => {
    console.log('[APP] Initializing - priming cache');
    api.primeCache();
  }, []);

  // Helper functions
  const resetState = () => {
    console.log('[RESET] Resetting application state');
    setError('');
    setReviews([]);
    setOriginalData([]);
    setExpandedItems(new Set());
    setFeedback({});
    setShowResults(false);
    setProcessedRows(0);
    setTotalRows(0);
  };

  const parseErrorMessage = (errorMessage) => {
    const errorMappings = {
      'RATE_LIMIT:': (msg) => msg.replace('RATE_LIMIT:', '').trim(),
      'OVERLOADED:': () => 'The API is currently overloaded. Please wait a minute and try again.',
      'INVALID_REQUEST:': (msg) => `Invalid request: ${msg.replace('INVALID_REQUEST:', '').trim()}`,
      'PERMISSION:': (msg) => `Permission denied: ${msg.replace('PERMISSION:', '').trim()}`,
      'NOT_FOUND:': (msg) => `Resource not found: ${msg.replace('NOT_FOUND:', '').trim()}`,
      'TOO_LARGE:': () => 'Request too large (>32MB). Try reducing the amount of data.',
      'SERVER_ERROR:': (msg) => `Server error: ${msg.replace('SERVER_ERROR:', '').trim()}`,
      'PARSE_ERROR:': (msg) => msg.replace('PARSE_ERROR:', '').trim(),
      'STRUCTURE_ERROR:': (msg) => msg.replace('STRUCTURE_ERROR:', '').trim(),
      'PARTIAL_FAILURE:': (msg) => msg.replace('PARTIAL_FAILURE:', '').trim()
    };

    for (const [prefix, handler] of Object.entries(errorMappings)) {
      if (errorMessage.startsWith(prefix)) {
        return handler(errorMessage);
      }
    }

    return `Error: ${errorMessage}`;
  };

  // File processing
  const processFile = async (fileToProcess) => {
    console.log('[PROCESS] Starting file processing');

    if (!fileToProcess) {
      console.error('[ERROR] No file provided');
      setError('Please select a file first');
      return;
    }

    setProcessing(true);
    setError('');
    setReviews([]);
    setOriginalData([]);
    setExpandedItems(new Set());
    setFeedback({});
    setProcessedRows(0);

    try {
      // Read and parse file
      console.log('[PROCESS] Reading file as array buffer');
      const arrayBuffer = await fileToProcess.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);

      if (jsonData.length === 0) {
        console.warn('[PROCESS] No data found in spreadsheet');
        setError('No data found in spreadsheet');
        setProcessing(false);
        return;
      }

      console.log('[PROCESS] Parsed', jsonData.length, 'rows from spreadsheet');
      setOriginalData(jsonData);
      setTotalRows(jsonData.length);

      // Process via API with progress callback
      const result = await api.processFile(jsonData, (processed, total) => {
        setProcessedRows(processed);
      });

      console.log('[SUCCESS] Received', result.reviews.length, 'reviews,', result.failedRows.length, 'failed');

      // Create placeholder reviews for failed rows
      const failedReviews = result.failedRows.map(row => ({
        unique_id: row.unique_id,
        originalIndex: row.originalIndex,
        student_name: row.data['Student Name'] || 'Unknown',
        student_id: row.data['Student Name']?.match(/\((\d+)\)$/)?.[1] || 'N/A',
        instructor: row.data['Instructors'] || 'Unknown',
        confidence: 1.0,
        needs_review: true,
        reason: 'api_failure',
        justification: `Failed to receive AI review after ${CONFIG.MAX_RETRIES + 1} attempts. Requires manual inspection.`
      }));

      // Combine successful and failed reviews
      const allReviews = [...result.reviews, ...failedReviews];
      console.log('[RESULTS] Total reviews:', allReviews.length, '(', result.reviews.length, 'successful,', failedReviews.length, 'failed)');
      setReviews(allReviews);

      // Summary logging
      const highCount = allReviews.filter(r => r.confidence >= CONFIG.HIGH_CONFIDENCE).length;
      const mediumCount = allReviews.filter(r => r.confidence >= CONFIG.MEDIUM_CONFIDENCE && r.confidence < CONFIG.HIGH_CONFIDENCE).length;
      const lowCount = allReviews.filter(r => r.confidence < CONFIG.REVIEW_THRESHOLD).length;
      const failedCount = failedReviews.length;

      console.log('[RESULTS] High confidence:', highCount, '| Medium:', mediumCount, '| Low:', lowCount, '| Failed:', failedCount);

      // Auto-expand high confidence items (including failed rows)
      const highConfidenceIndices = new Set(
        allReviews
          .map((r, idx) => ({ ...r, originalIdx: idx }))
          .filter(r => r.confidence >= CONFIG.HIGH_CONFIDENCE)
          .map(r => r.originalIdx)
      );
      console.log('[EXPAND] Auto-expanding', highConfidenceIndices.size, 'high-confidence items');
      setExpandedItems(highConfidenceIndices);

    } catch (err) {
      console.error('[ERROR] Processing failed:', err.message);
      console.error('[ERROR] Full error object:', err);
      setError(parseErrorMessage(err.message));
    } finally {
      console.log('[PROCESS] Processing complete');
      setProcessing(false);
      setProcessedRows(0);
      setTotalRows(0);
    }
  };

  // File handling
  const handleFileSelection = (selectedFile) => {
    console.log('[FILE] Selected:', selectedFile?.name);

    if (selectedFile && selectedFile.name.endsWith('.xlsx')) {
      setFile(selectedFile);
      resetState();
      console.log('[PROCESSING] Starting background processing');
      processFile(selectedFile);
    } else {
      console.warn('[FILE] Invalid file type - must be .xlsx');
      setError('Please select an XLSX file');
      setFile(null);
    }
  };

  const handleFileChange = (e) => {
    handleFileSelection(e.target.files[0]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelection(e.dataTransfer.files[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // UI interactions
  const toggleExpanded = (idx) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(idx)) {
      newExpanded.delete(idx);
    } else {
      newExpanded.add(idx);
    }
    setExpandedItems(newExpanded);
  };

  const handleFeedback = async (reviewIdx, feedbackType) => {
    setFeedback(prev => ({
      ...prev,
      [reviewIdx]: feedbackType
    }));

    // Get the review data for this index
    const review = reviews[reviewIdx];
    const rowData = originalData[review.row_index];

    // Send feedback to backend
    try {
      const response = await fetch('https://mathsense.com/session-notes/api/feedback.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          row_json: rowData,
          claude_response_json: review,
          feedback_type: feedbackType
        })
      });

      if (!response.ok) {
        console.error('Failed to submit feedback:', await response.text());
      } else {
        console.log(`Feedback logged: ${feedbackType} for review ${reviewIdx}`);
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
    }
  };

  const getReasonLabel = (reason) => {
    return CONFIG.REASON_LABELS[reason] || reason;
  };

  const getConfidenceLabel = (confidence) => {
    if (confidence >= CONFIG.HIGH_CONFIDENCE) return CONFIG.CONFIDENCE_STYLES.high;
    if (confidence >= CONFIG.MEDIUM_CONFIDENCE) return CONFIG.CONFIDENCE_STYLES.medium;
    return CONFIG.CONFIDENCE_STYLES.low;
  };

  // Filter reviews
  const highConfidenceReviews = reviews.filter(r => r.confidence >= CONFIG.REVIEW_THRESHOLD);
  const lowConfidenceReviews = reviews.filter(r => r.confidence < CONFIG.REVIEW_THRESHOLD);

  // Error classification
  const isRetryableError = error && (
    error.toLowerCase().includes('overloaded') ||
    error.toLowerCase().includes('server error')
  );

  const isRateLimitError = error && (
    error.toLowerCase().includes('rate limit') ||
    error.toLowerCase().includes('usage limit')
  );

  // Render feedback button
  const renderFeedbackButton = (reviewIdx, isHighConfidence) => {
    const currentFeedback = feedback[reviewIdx];

    if (isHighConfidence) {
      // For high confidence (flagged items), only show "False Positive" button
      return (
        <button
          onClick={() => handleFeedback(reviewIdx, 'false_positive')}
          style={{
            padding: '0.25rem 0.75rem',
            backgroundColor: currentFeedback === 'false_positive' ? '#65a30d' : 'transparent',
            color: currentFeedback === 'false_positive' ? 'white' : '#64748b',
            border: '1px solid #e2e8f0',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
          onMouseEnter={(e) => {
            if (currentFeedback !== 'false_positive') {
              e.target.style.borderColor = '#cbd5e1';
              e.target.style.color = '#475569';
            }
          }}
          onMouseLeave={(e) => {
            if (currentFeedback !== 'false_positive') {
              e.target.style.borderColor = '#e2e8f0';
              e.target.style.color = '#64748b';
            }
          }}
        >
          {currentFeedback === 'false_positive' ? '✓ Marked as Fine' : 'Actually Looks Fine'}
        </button>
      );
    } else {
      // For low confidence (not flagged items), only show "False Negative" button
      return (
        <button
          onClick={() => handleFeedback(reviewIdx, 'false_negative')}
          style={{
            padding: '0.25rem 0.75rem',
            backgroundColor: currentFeedback === 'false_negative' ? '#991b1b' : 'transparent',
            color: currentFeedback === 'false_negative' ? 'white' : '#64748b',
            border: '1px solid #e2e8f0',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
            cursor: 'pointer',
            transition: 'all 0.15s'
          }}
          onMouseEnter={(e) => {
            if (currentFeedback !== 'false_negative') {
              e.target.style.borderColor = '#cbd5e1';
              e.target.style.color = '#475569';
            }
          }}
          onMouseLeave={(e) => {
            if (currentFeedback !== 'false_negative') {
              e.target.style.borderColor = '#e2e8f0';
              e.target.style.color = '#64748b';
            }
          }}
        >
          {currentFeedback === 'false_negative' ? '✓ Marked for Review' : 'Actually Needs Review'}
        </button>
      );
    }
  };

  // Button text with progress
  const getButtonText = () => {
    if (!showResults) {
      return 'Review Session Notes';
    }

    if (processing && processedRows > 0 && totalRows > 0) {
      return `Reviewing: ${processedRows}/${totalRows} notes processed`;
    }

    if (processing) {
      return 'Reviewing Notes...';
    }

    return 'Review Session Notes';
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom right, #1a2332, #2d8b8b)',
      padding: '2rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      <div style={{ maxWidth: '64rem', margin: '0 auto' }}>
        <div style={{
          backgroundColor: '#f1faee',
          borderRadius: '0.5rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          padding: '2rem'
        }}>
          <h1 style={{
            fontSize: '1.875rem',
            fontWeight: 'bold',
            color: '#1a2332',
            marginBottom: '1.5rem'
          }}>
            Session Notes Reviewer
          </h1>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: '500',
              color: '#1a2332',
              marginBottom: '0.5rem'
            }}>
              Upload Session Notes (XLSX)
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              style={{
                border: isDragging ? '2px dashed #2d8b8b' : '2px dashed #a8dadc',
                borderRadius: '0.375rem',
                padding: '1.5rem',
                textAlign: 'center',
                backgroundColor: isDragging ? '#e0f2f1' : 'white',
                transition: 'all 0.2s',
                cursor: 'pointer',
                position: 'relative'
              }}
              onClick={() => document.getElementById('file-input').click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".xlsx"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              {file ? (
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#2d8b8b', fontWeight: '500' }}>
                  Selected: {file.name}
                </p>
              ) : (
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                  Drop XLSX file here or click to browse
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => {
              console.log('[BUTTON] Review button clicked');
              setShowResults(true);
            }}
            disabled={!file}
            style={{
              width: '100%',
              backgroundColor: file ? '#2d8b8b' : '#a8dadc',
              color: '#f1faee',
              padding: '0.75rem 1rem',
              borderRadius: '0.375rem',
              fontWeight: '600',
              border: 'none',
              cursor: file ? 'pointer' : 'not-allowed',
              transition: 'background-color 0.2s',
              fontSize: '1rem'
            }}
            onMouseEnter={(e) => {
              if (file) {
                e.target.style.backgroundColor = '#247373';
              }
            }}
            onMouseLeave={(e) => {
              if (file) {
                e.target.style.backgroundColor = '#2d8b8b';
              }
            }}
          >
            {getButtonText()}
          </button>

          {showResults && error && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '0.375rem'
            }}>
              <p style={{ color: '#991b1b', fontWeight: '600' }}>
                {isRateLimitError ? 'Rate Limit Reached' :
                 isRetryableError ? 'Temporary Issue' :
                 'Error'}
              </p>
              <p style={{ color: '#b91c1c', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                {error}
              </p>
              {isRetryableError && (
                <p style={{
                  color: '#dc2626',
                  fontSize: '0.875rem',
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid #fecaca'
                }}>
                  This is a temporary issue. Please wait a minute and try again.
                </p>
              )}
              {!isRateLimitError && !isRetryableError && (
                <p style={{
                  color: '#dc2626',
                  fontSize: '0.875rem',
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid #fecaca'
                }}>
                  Contact Joshua about this issue on Slack—thank you!
                </p>
              )}
            </div>
          )}

          {showResults && processing && (
            <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{
                width: '3rem',
                height: '3rem',
                border: '4px solid #a8dadc',
                borderTopColor: '#2d8b8b',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          )}

          {showResults && reviews.length > 0 && !processing && (
            <>
              {highConfidenceReviews.length > 0 && (
                <p style={{
                  marginTop: '1.5rem',
                  color: '#1a2332',
                  fontSize: '0.875rem',
                  fontWeight: '500'
                }}>
                  {highConfidenceReviews.length} {highConfidenceReviews.length === 1 ? 'session requires' : 'sessions require'} review
                </p>
              )}

              {/* High Confidence Reviews */}
              {highConfidenceReviews.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h2 style={{
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    color: '#1a2332',
                    marginBottom: '1rem'
                  }}>
                    Priority Reviews
                  </h2>

                  {highConfidenceReviews.map((review, idx) => {
                    const originalIdx = reviews.indexOf(review);
                    const isExpanded = expandedItems.has(originalIdx);
                    return ReviewComponents.renderHighConfidenceReview(
                      review,
                      originalIdx,
                      isExpanded,
                      originalData,
                      toggleExpanded,
                      getConfidenceLabel,
                      getReasonLabel,
                      renderFeedbackButton
                    );
                  })}
                </div>
              )}

              {/* Low Confidence Reviews */}
              {lowConfidenceReviews.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <h2 style={{
                    fontSize: '1.25rem',
                    fontWeight: 'bold',
                    color: '#64748b',
                    marginBottom: '1rem'
                  }}>
                    Lower Priority
                  </h2>

                  {lowConfidenceReviews
                    .sort((a, b) => b.confidence - a.confidence)
                    .map((review, idx) => {
                      const originalIdx = reviews.indexOf(review);
                      const isExpanded = expandedItems.has(originalIdx);
                      return ReviewComponents.renderLowConfidenceReview(
                        review,
                        originalIdx,
                        isExpanded,
                        originalData,
                        toggleExpanded,
                        getConfidenceLabel,
                        getReasonLabel,
                        renderFeedbackButton
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Render the component
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<SessionNotesReviewerEnhanced />);
