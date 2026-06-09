import DOMPurify from 'dompurify';

// Sanitizza l'HTML autorato dagli admin (TinyMCE: istruzioni, what's new,
// site content) prima di passarlo a dangerouslySetInnerHTML. Il contenuto
// arriva solo da account admin, ma se uno di quegli account venisse
// compromesso uno <script> iniettato girerebbe nel browser di TUTTI gli
// utenti (e il token JWT vive in localStorage). DOMPurify rimuove script,
// handler inline (onclick, onerror, ...) e URL javascript:, lasciando
// intatta la formattazione TinyMCE (tabelle, immagini, link, stili).
export function sanitizeHtml(html) {
    return DOMPurify.sanitize(html || '');
}
