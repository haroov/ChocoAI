import React from 'react';

interface MermaidDiagramProps {
    chart: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart }) => {
  // Use btoa for browser-side base64 encoding
  // standard btoa works for ASCII which is standard for mermaid syntax
  const encoded = window.btoa(chart);
  const imageUrl = `https://mermaid.ink/img/${encoded}`;

  return (
    <div className="overflow-x-auto p-4 border rounded bg-white mt-4">
      <img src={imageUrl} alt="Mermaid Diagram" />
    </div>
  );
};
