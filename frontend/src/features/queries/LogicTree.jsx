import { useEffect, useRef, useMemo, useCallback } from 'react';
import mermaid from 'mermaid';

// Inizializzazione Mermaid
mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
        primaryColor: '#e1f5fe',
        edgeLabelBackground: '#ffffff',
        tertiaryColor: '#f5f5f5'
    }
});

export default function LogicTree({ tree }) {
    const containerRef = useRef(null);
    const mermaidId = useMemo(() => `mermaid-${Math.random().toString(36).substr(2, 9)}`, []);

    // Funzione ricorsiva per convertire il JSON in sintassi Mermaid
    const generateMermaidString = useCallback((node, idObj = { count: 0 }) => {
        const id = `n${idObj.count++}`;
        let str = "";

        // Colore in base al risultato booleano
        const color = node.result ? "fill:#c8e6c9,stroke:#2e7d32" : "fill:#ffcdd2,stroke:#c62828";
        const label = node.type === "LEAF" ? `${node.label} (${node.actual_value})` : node.label;

        str += `${id}["${label}"]\n`;
        str += `style ${id} ${color}\n`;

        if (node.children) {
            node.children.forEach(child => {
                const childResult = generateMermaidString(child, idObj);
                str += `${id} --> ${childResult.id}\n`;
                str += childResult.str;
            });
        }
        return { id, str };
    }, []);

    useEffect(() => {
        if (tree && containerRef.current) {
            const { str } = generateMermaidString(tree);
            const graphDefinition = `graph LR\n${str}`;

            // Renderizzazione manuale del diagramma
            containerRef.current.innerHTML = ""; // Pulisce
            mermaid.render(mermaidId, graphDefinition).then(({ svg }) => {
                if (containerRef.current) {
                    containerRef.current.innerHTML = svg;
                }
            }).catch(e => console.error("Errore Mermaid:", e));
        }
    }, [tree, mermaidId, generateMermaidString]);

    return (
        <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px', border: '1px solid #ddd', overflowX: 'auto' }}>
            <p className="muted small mb-3">Logic Signal Flow (Green: TRUE, Red: FALSE):</p>
            <div ref={containerRef} id={`${mermaidId}-container`}></div>
        </div>
    );
}