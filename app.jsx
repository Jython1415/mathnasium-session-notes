const { useState, useEffect } = React;

function SessionNotesReviewerEnhanced() {
  // File and processing state
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [originalData, setOriginalData] = useState([]);
  const [error, setError] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [validationWarnings, setValidationWarnings] = useState([]);

  // UI state
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [feedback, setFeedback] = useState({});
  const [isDragging, setIsDragging] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [copiedReviews, setCopiedReviews] = useState(new Set());

  // Progress tracking
  const [processedRows, setProcessedRows] = useState(0);
  const [totalRows, setTotalRows] = useState(0);

  // Prime cache on page load
  useEffect(() => {
    console.log('[APP] Initializing - priming cache');
    api.primeCache();
  }, []);

  // Scroll listener for jump to top button
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
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
    setPreviewData(null);
    setValidationWarnings([]);
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


  // File handling
  const handleFileSelection = async (selectedFile) => {
    console.log('[FILE] Selected:', selectedFile?.name);

    if (selectedFile && selectedFile.name.endsWith('.xlsx')) {
      setFile(selectedFile);
      resetState();
      setError('');

      // Read file and show preview
      try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

        if (jsonData.length === 0) {
          setError('No data found in spreadsheet');
          setFile(null);
          return;
        }

        // Validate required columns
        const requiredColumns = ['Student Name', 'Instructors', 'Session Summary Notes', 'Date'];
        const warnings = [];
        const firstRow = jsonData[0];
        const actualColumns = Object.keys(firstRow);

        requiredColumns.forEach(col => {
          if (!actualColumns.includes(col)) {
            warnings.push(`Missing required column: "${col}"`);
          }
        });

        // Check for empty critical fields in preview rows
        const previewRows = jsonData.slice(0, 5);
        const emptySummaries = previewRows.filter(row => !row['Session Summary Notes']).length;
        if (emptySummaries > 0) {
          warnings.push(`${emptySummaries} of first 5 rows have empty Session Summary Notes`);
        }

        setValidationWarnings(warnings);

        // Show preview of first 5 rows
        setPreviewData({
          rows: jsonData.slice(0, 5),
          totalRows: jsonData.length,
          allData: jsonData
        });
      } catch (err) {
        console.error('[ERROR] Failed to read file:', err);
        setError('Failed to read file. Please ensure it\'s a valid XLSX file.');
        setFile(null);
      }
    } else {
      console.warn('[FILE] Invalid file type - must be .xlsx');
      setError('Please select an XLSX file');
      setFile(null);
    }
  };

  const proceedWithProcessing = async () => {
    if (previewData && previewData.allData) {
      setShowResults(true);
      setProcessing(true);
      setError('');
      setReviews([]);
      setOriginalData([]);
      setExpandedItems(new Set());
      setFeedback({});
      setProcessedRows(0);

      try {
        const jsonData = previewData.allData;
        console.log('[PROCESS] Using cached data, processing', jsonData.length, 'rows');
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

        // Auto-expand all items that need review (above threshold)
        const itemsNeedingReview = new Set(
          allReviews
            .map((r, idx) => ({ ...r, originalIdx: idx }))
            .filter(r => r.confidence >= CONFIG.REVIEW_THRESHOLD)
            .map(r => r.originalIdx)
        );
        console.log('[EXPAND] Auto-expanding', itemsNeedingReview.size, 'items above review threshold');
        setExpandedItems(itemsNeedingReview);

      } catch (err) {
        console.error('[ERROR] Processing failed:', err.message);
        setError(parseErrorMessage(err.message));
      } finally {
        console.log('[PROCESS] Processing complete');
        setProcessing(false);
        setProcessedRows(0);
        setTotalRows(0);
      }
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

  const expandAll = (reviewList) => {
    const indices = reviewList.map(review => reviews.indexOf(review));
    setExpandedItems(new Set([...expandedItems, ...indices]));
  };

  const collapseAll = (reviewList) => {
    const indices = new Set(reviewList.map(review => reviews.indexOf(review)));
    const newExpanded = new Set([...expandedItems].filter(idx => !indices.has(idx)));
    setExpandedItems(newExpanded);
  };

  const handleFeedback = async (reviewIdx, feedbackType) => {
    setFeedback(prev => ({
      ...prev,
      [reviewIdx]: feedbackType
    }));

    // Get the review data for this index
    const review = reviews[reviewIdx];
    const rowData = originalData[review.originalIndex];

    // Send feedback to backend
    try {
      const response = await fetch('api/feedback.php', {
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

  const handleCopyReview = async (reviewIdx) => {
    const review = reviews[reviewIdx];
    const rowData = originalData[review.originalIndex];

    const copyText = `🚨 Session Note Review Alert

Student: ${review.student_name} [${review.student_id}]
Instructor: ${review.instructor}
Date: ${rowData['Date'] || 'N/A'}
Issue: ${getReasonLabel(review.reason)}
Confidence: ${getConfidenceLabel(review.confidence).label}

Why Flagged: ${review.justification}

Session Summary Notes:
${rowData['Session Summary Notes'] || '(empty)'}

${rowData['Internal Notes'] ? `Internal Notes:\n${rowData['Internal Notes']}\n\n` : ''}${rowData['Schoolwork Description'] ? `Schoolwork Description:\n${rowData['Schoolwork Description']}` : ''}`;

    try {
      await navigator.clipboard.writeText(copyText);
      setCopiedReviews(prev => new Set([...prev, reviewIdx]));
      setTimeout(() => {
        setCopiedReviews(prev => {
          const newSet = new Set(prev);
          newSet.delete(reviewIdx);
          return newSet;
        });
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getConfidenceLabel = (confidence) => {
    if (confidence >= CONFIG.HIGH_CONFIDENCE) return CONFIG.CONFIDENCE_STYLES.high;
    if (confidence >= CONFIG.MEDIUM_CONFIDENCE) return CONFIG.CONFIDENCE_STYLES.medium;
    return CONFIG.CONFIDENCE_STYLES.low;
  };

  // Filter reviews by search text
  const filteredReviews = reviews.filter(review => {
    if (!filterText.trim()) return true;
    const searchText = filterText.toLowerCase();
    return (
      review.student_name.toLowerCase().includes(searchText) ||
      review.instructor.toLowerCase().includes(searchText)
    );
  });

  // Separate into high and low confidence
  const highConfidenceReviews = filteredReviews.filter(r => r.confidence >= CONFIG.REVIEW_THRESHOLD);
  const lowConfidenceReviews = filteredReviews.filter(r => r.confidence < CONFIG.REVIEW_THRESHOLD);

  // Calculate statistics by reason
  const getReasonStats = () => {
    const stats = {};
    reviews.forEach(review => {
      if (review.confidence >= CONFIG.REVIEW_THRESHOLD) {
        stats[review.reason] = (stats[review.reason] || 0) + 1;
      }
    });
    return Object.entries(stats)
      .filter(([reason, _]) => reason !== 'none')
      .sort((a, b) => b[1] - a[1]);
  };

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

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="app-container" style={{
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

          {/* File preview */}
          {previewData && !showResults && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: '#f8fafc',
              borderRadius: '0.375rem',
              border: '1px solid #cbd5e1'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem'
              }}>
                <p style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: '#1a2332',
                  margin: 0
                }}>
                  File Preview ({previewData.totalRows} sessions)
                </p>
                <button
                  onClick={() => {
                    setFile(null);
                    setPreviewData(null);
                  }}
                  style={{
                    padding: '0.25rem 0.5rem',
                    backgroundColor: 'transparent',
                    color: '#64748b',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.25rem',
                    fontSize: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  Clear
                </button>
              </div>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '0.25rem',
                border: '1px solid #e2e8f0',
                overflowX: 'auto',
                fontSize: '0.75rem'
              }}>
                <table className="preview-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f1f5f9' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '600' }}>Student</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '600' }}>Instructor</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: '600' }}>Summary Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: idx < previewData.rows.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                        <td style={{ padding: '0.5rem', color: '#1a2332' }}>{row['Student Name'] || '—'}</td>
                        <td style={{ padding: '0.5rem', color: '#1a2332' }}>{row['Instructors'] || '—'}</td>
                        <td style={{
                          padding: '0.5rem',
                          color: '#1a2332',
                          maxWidth: '300px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {row['Session Summary Notes'] || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {validationWarnings.length > 0 && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '0.25rem'
                }}>
                  <p style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    color: '#92400e',
                    marginBottom: '0.25rem'
                  }}>
                    ⚠️ Validation Warnings
                  </p>
                  {validationWarnings.map((warning, idx) => (
                    <p key={idx} style={{
                      fontSize: '0.75rem',
                      color: '#b45309',
                      margin: '0.125rem 0',
                      paddingLeft: '1rem'
                    }}>
                      • {warning}
                    </p>
                  ))}
                </div>
              )}
              {previewData.totalRows > 5 && (
                <p style={{
                  marginTop: '0.5rem',
                  fontSize: '0.75rem',
                  color: '#64748b',
                  fontStyle: 'italic'
                }}>
                  Showing first 5 of {previewData.totalRows} sessions
                </p>
              )}
            </div>
          )}

          <button
            onClick={previewData && !showResults ? proceedWithProcessing : () => {
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
              fontSize: '1rem',
              marginTop: previewData && !showResults ? '1rem' : '0'
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
            {previewData && !showResults ? `Process ${previewData.totalRows} Sessions` : getButtonText()}
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
            <div style={{ marginTop: '1.5rem' }}>
              {/* Progress bar */}
              {processedRows > 0 && totalRows > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '0.5rem',
                    fontSize: '0.875rem',
                    color: '#475569',
                    fontWeight: '500'
                  }}>
                    <span>Processing reviews...</span>
                    <span>{processedRows} / {totalRows} ({Math.round((processedRows / totalRows) * 100)}%)</span>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '0.5rem',
                    backgroundColor: '#e2e8f0',
                    borderRadius: '0.25rem',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${(processedRows / totalRows) * 100}%`,
                      height: '100%',
                      backgroundColor: '#2d8b8b',
                      transition: 'width 0.3s ease',
                      borderRadius: '0.25rem'
                    }}></div>
                  </div>
                </div>
              )}
              {/* Spinner */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            </div>
          )}

          {showResults && reviews.length > 0 && !processing && (
            <>
              {highConfidenceReviews.length > 0 && (
                <>
                  <p style={{
                    marginTop: '1.5rem',
                    color: '#1a2332',
                    fontSize: '0.875rem',
                    fontWeight: '500'
                  }}>
                    {highConfidenceReviews.length} {highConfidenceReviews.length === 1 ? 'session requires' : 'sessions require'} review
                  </p>
                  {/* Statistics summary */}
                  {getReasonStats().length > 0 && (
                    <div style={{
                      marginTop: '0.75rem',
                      padding: '1rem',
                      backgroundColor: '#f8fafc',
                      borderRadius: '0.375rem',
                      border: '1px solid #e2e8f0'
                    }}>
                      <p style={{
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: '0.5rem'
                      }}>
                        Issues by Type
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {getReasonStats().map(([reason, count]) => (
                          <div
                            key={reason}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.375rem',
                              padding: '0.25rem 0.625rem',
                              backgroundColor: 'white',
                              border: '1px solid #cbd5e1',
                              borderRadius: '0.25rem',
                              fontSize: '0.875rem'
                            }}
                          >
                            <span style={{ color: '#475569', fontWeight: '500' }}>
                              {getReasonLabel(reason)}
                            </span>
                            <span style={{
                              backgroundColor: '#2d8b8b',
                              color: 'white',
                              padding: '0.125rem 0.375rem',
                              borderRadius: '0.25rem',
                              fontSize: '0.75rem',
                              fontWeight: '600'
                            }}>
                              {count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Filter input */}
              {reviews.length > 0 && (
                <div style={{ marginTop: '1rem', marginBottom: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Filter by student name or instructor..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.625rem 0.875rem',
                      fontSize: '0.875rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '0.375rem',
                      outline: 'none',
                      transition: 'border-color 0.15s'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#2d8b8b'}
                    onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                  />
                  {filterText && (
                    <p style={{
                      marginTop: '0.5rem',
                      fontSize: '0.75rem',
                      color: '#64748b'
                    }}>
                      Showing {filteredReviews.length} of {reviews.length} reviews
                    </p>
                  )}
                </div>
              )}

              {/* High Confidence Reviews */}
              {highConfidenceReviews.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h2 style={{
                      fontSize: '1.5rem',
                      fontWeight: 'bold',
                      color: '#1a2332',
                      margin: 0
                    }}>
                      Priority Reviews
                    </h2>
                    <div className="button-group" style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => expandAll(highConfidenceReviews)}
                        style={{
                          padding: '0.375rem 0.75rem',
                          backgroundColor: 'white',
                          color: '#2d8b8b',
                          border: '1px solid #2d8b8b',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          fontWeight: '500'
                        }}
                      >
                        Expand All
                      </button>
                      <button
                        onClick={() => collapseAll(highConfidenceReviews)}
                        style={{
                          padding: '0.375rem 0.75rem',
                          backgroundColor: 'white',
                          color: '#64748b',
                          border: '1px solid #cbd5e1',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          fontWeight: '500'
                        }}
                      >
                        Collapse All
                      </button>
                    </div>
                  </div>

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
                      renderFeedbackButton,
                      handleCopyReview,
                      copiedReviews.has(originalIdx)
                    );
                  })}
                </div>
              )}

              {/* Low Confidence Reviews */}
              {lowConfidenceReviews.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h2 style={{
                      fontSize: '1.25rem',
                      fontWeight: 'bold',
                      color: '#64748b',
                      margin: 0
                    }}>
                      Lower Priority
                    </h2>
                    <div className="button-group" style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => expandAll(lowConfidenceReviews)}
                        style={{
                          padding: '0.375rem 0.75rem',
                          backgroundColor: 'white',
                          color: '#2d8b8b',
                          border: '1px solid #2d8b8b',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          fontWeight: '500'
                        }}
                      >
                        Expand All
                      </button>
                      <button
                        onClick={() => collapseAll(lowConfidenceReviews)}
                        style={{
                          padding: '0.375rem 0.75rem',
                          backgroundColor: 'white',
                          color: '#64748b',
                          border: '1px solid #cbd5e1',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          fontWeight: '500'
                        }}
                      >
                        Collapse All
                      </button>
                    </div>
                  </div>

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
                        renderFeedbackButton,
                        handleCopyReview,
                        copiedReviews.has(originalIdx)
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Jump to top button */}
      {showScrollTop && (
        <button
          className="jump-to-top"
          onClick={scrollToTop}
          style={{
            position: 'fixed',
            bottom: '2rem',
            right: '2rem',
            width: '3rem',
            height: '3rem',
            backgroundColor: '#2d8b8b',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            fontSize: '1.5rem',
            cursor: 'pointer',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
            zIndex: 1000
          }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = '#247373';
            e.target.style.transform = 'translateY(-2px)';
            e.target.style.boxShadow = '0 6px 8px rgba(0, 0, 0, 0.15), 0 3px 6px rgba(0, 0, 0, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = '#2d8b8b';
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)';
          }}
        >
          ↑
        </button>
      )}
    </div>
  );
}

// Render the component
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<SessionNotesReviewerEnhanced />);
