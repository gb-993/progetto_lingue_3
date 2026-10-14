export default function ParamBadges({ hasAnswerConflict = false, needsReview = false }) {
    if (!hasAnswerConflict && !needsReview) return null;
    return (
        <span className="param-badges">
            {hasAnswerConflict && (
                <span
                    className="badge-conflict"
                    title="Answer conflict: a question and a stop question are both answered YES"
                >
                    !
                </span>
            )}
            {needsReview && (
                <span
                    className="badge-review"
                    title="A question was modified — re-check and re-save this parameter"
                >
                    ✎
                </span>
            )}
        </span>
    );
}
