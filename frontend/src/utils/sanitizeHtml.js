import DOMPurify from 'dompurify';

// pulisce l'HTML prima di mostrarlo, anche quello degli admin
export function sanitizeHtml(html) {
    return DOMPurify.sanitize(html || '');
}
