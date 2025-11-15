// UI Component functions for rendering reviews

const ReviewComponents = {
  // Render high confidence review card
  renderHighConfidenceReview: (review, originalIdx, isExpanded, originalData, toggleExpanded, getConfidenceLabel, getReasonLabel, renderFeedbackButton) => {
    return React.createElement('div', {
      key: originalIdx,
      style: {
        marginBottom: '1rem',
        padding: '1rem',
        backgroundColor: 'white',
        borderRadius: '0.5rem',
        border: '2px solid #fecaca',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'pointer'
      }
    }, [
      // Header (clickable)
      React.createElement('div', {
        key: 'header',
        onClick: () => toggleExpanded(originalIdx),
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start' }
      }, [
        React.createElement('div', { key: 'content', style: { flex: 1 } }, [
          React.createElement('div', {
            key: 'title',
            style: { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }
          }, [
            React.createElement('p', {
              key: 'name',
              style: { fontWeight: '700', color: '#1a2332', fontSize: '1rem', margin: 0 }
            }, `${review.student_name} [${review.student_id}]`),
            React.createElement('div', {
              key: 'confidence',
              style: {
                backgroundColor: getConfidenceLabel(review.confidence).bg,
                color: getConfidenceLabel(review.confidence).color,
                padding: '0.25rem 0.75rem',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                fontWeight: '600',
                border: `1px solid ${getConfidenceLabel(review.confidence).color}`
              }
            }, `${getConfidenceLabel(review.confidence).label} Confidence`)
          ]),
          React.createElement('p', {
            key: 'instructor',
            style: { fontSize: '0.875rem', color: '#475569', margin: '0.25rem 0' }
          }, `Instructor: ${review.instructor}`),
          React.createElement('div', {
            key: 'reason',
            style: {
              display: 'inline-block',
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              padding: '0.25rem 0.5rem',
              borderRadius: '0.25rem',
              fontSize: '0.75rem',
              fontWeight: '600',
              marginTop: '0.5rem'
            }
          }, getReasonLabel(review.reason)),
          React.createElement('p', {
            key: 'justification',
            style: { color: '#1a2332', fontSize: '0.875rem', lineHeight: '1.5', marginTop: '0.5rem' }
          }, review.justification)
        ]),
        React.createElement('div', {
          key: 'arrow',
          style: { marginLeft: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }
        }, React.createElement('span', { style: { fontSize: '1.25rem', color: '#64748b' } }, isExpanded ? '▼' : '▶'))
      ]),

      // Expanded content
      isExpanded && React.createElement('div', {
        key: 'expanded',
        onClick: (e) => e.stopPropagation(),
        style: { marginTop: '1rem', paddingTop: '1rem', borderTop: '2px solid #fee2e2' }
      }, [
        originalData[review.originalIndex]?.['Session Summary Notes'] && React.createElement('div', {
          key: 'summary',
          style: { marginBottom: '0.75rem' }
        }, [
          React.createElement('p', {
            key: 'label',
            style: {
              fontSize: '0.75rem',
              fontWeight: '600',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.5rem'
            }
          }, 'Session Summary Notes'),
          React.createElement('div', {
            key: 'content',
            style: {
              backgroundColor: '#f8fafc',
              padding: '0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #e2e8f0',
              fontSize: '0.875rem',
              lineHeight: '1.6',
              color: '#1a2332',
              fontFamily: 'Georgia, serif',
              fontStyle: 'italic'
            }
          }, originalData[review.originalIndex]['Session Summary Notes'])
        ]),
        originalData[review.originalIndex]?.['Internal Notes'] && React.createElement('div', {
          key: 'internal',
          style: { marginBottom: '0.75rem' }
        }, [
          React.createElement('p', {
            key: 'label',
            style: {
              fontSize: '0.75rem',
              fontWeight: '600',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.5rem'
            }
          }, 'Internal Notes'),
          React.createElement('div', {
            key: 'content',
            style: {
              backgroundColor: '#fffbeb',
              padding: '0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #fde68a',
              fontSize: '0.875rem',
              lineHeight: '1.6',
              color: '#1a2332'
            }
          }, originalData[review.originalIndex]['Internal Notes'])
        ]),
        originalData[review.originalIndex]?.['Schoolwork Description'] && React.createElement('div', {
          key: 'schoolwork',
          style: { marginBottom: '0.75rem' }
        }, [
          React.createElement('p', {
            key: 'label',
            style: {
              fontSize: '0.75rem',
              fontWeight: '600',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.5rem'
            }
          }, 'Schoolwork Description (Should be empty)'),
          React.createElement('div', {
            key: 'content',
            style: {
              backgroundColor: '#fef2f2',
              padding: '0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #fecaca',
              fontSize: '0.875rem',
              lineHeight: '1.6',
              color: '#1a2332'
            }
          }, originalData[review.originalIndex]['Schoolwork Description'])
        ]),
        React.createElement('div', {
          key: 'feedback',
          style: {
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid #e5e7eb'
          }
        }, renderFeedbackButton(originalIdx, true))
      ])
    ]);
  },

  // Render low confidence review card
  renderLowConfidenceReview: (review, originalIdx, isExpanded, originalData, toggleExpanded, getConfidenceLabel, getReasonLabel, renderFeedbackButton) => {
    return React.createElement('div', {
      key: originalIdx,
      style: {
        marginBottom: '0.75rem',
        padding: '0.75rem',
        backgroundColor: isExpanded ? 'white' : '#f8fafc',
        borderRadius: '0.375rem',
        border: '1px solid #e2e8f0',
        cursor: 'pointer'
      }
    }, [
      // Header (clickable)
      React.createElement('div', {
        key: 'header',
        onClick: () => toggleExpanded(originalIdx),
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start' }
      }, [
        React.createElement('div', { key: 'content', style: { flex: 1 } }, [
          React.createElement('div', {
            key: 'title',
            style: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }
          }, [
            React.createElement('p', {
              key: 'name',
              style: { fontWeight: '600', color: '#475569', fontSize: '0.875rem', margin: 0 }
            }, `${review.student_name} [${review.student_id}] - ${review.instructor}`),
            React.createElement('div', {
              key: 'confidence',
              style: {
                backgroundColor: getConfidenceLabel(review.confidence).bg,
                color: getConfidenceLabel(review.confidence).color,
                padding: '0.125rem 0.5rem',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                fontWeight: '600',
                border: `1px solid ${getConfidenceLabel(review.confidence).color}`
              }
            }, getConfidenceLabel(review.confidence).label)
          ]),
          !isExpanded && React.createElement('p', {
            key: 'preview',
            style: { fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem', margin: '0.25rem 0 0 0' }
          }, [
            review.reason !== 'none' && React.createElement('span', {
              key: 'reason',
              style: {
                backgroundColor: '#e2e8f0',
                padding: '2px 6px',
                borderRadius: '0.25rem',
                marginRight: '0.5rem'
              }
            }, getReasonLabel(review.reason)),
            review.justification
          ])
        ]),
        React.createElement('div', {
          key: 'arrow',
          style: { marginLeft: '0.5rem' }
        }, React.createElement('span', { style: { fontSize: '1rem', color: '#64748b' } }, isExpanded ? '▼' : '▶'))
      ]),

      // Expanded content
      isExpanded && React.createElement('div', {
        key: 'expanded',
        onClick: (e) => e.stopPropagation(),
        style: { marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }
      }, [
        React.createElement('div', {
          key: 'reason',
          style: {
            display: 'inline-block',
            backgroundColor: '#f1f5f9',
            color: '#475569',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
            fontSize: '0.75rem',
            fontWeight: '600',
            marginBottom: '0.5rem'
          }
        }, getReasonLabel(review.reason)),
        React.createElement('p', {
          key: 'justification',
          style: { color: '#1a2332', fontSize: '0.875rem', lineHeight: '1.5', marginBottom: '0.75rem' }
        }, review.justification),
        originalData[review.originalIndex]?.['Session Summary Notes'] && React.createElement('div', {
          key: 'summary',
          style: { marginBottom: '0.75rem' }
        }, [
          React.createElement('p', {
            key: 'label',
            style: {
              fontSize: '0.75rem',
              fontWeight: '600',
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.5rem'
            }
          }, 'Session Summary Notes'),
          React.createElement('div', {
            key: 'content',
            style: {
              backgroundColor: '#f8fafc',
              padding: '0.75rem',
              borderRadius: '0.375rem',
              border: '1px solid #e2e8f0',
              fontSize: '0.875rem',
              lineHeight: '1.6',
              color: '#1a2332',
              fontFamily: 'Georgia, serif',
              fontStyle: 'italic'
            }
          }, originalData[review.originalIndex]['Session Summary Notes'])
        ]),
        React.createElement('div', {
          key: 'feedback',
          style: {
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid #e5e7eb'
          }
        }, renderFeedbackButton(originalIdx, false))
      ])
    ]);
  }
};
