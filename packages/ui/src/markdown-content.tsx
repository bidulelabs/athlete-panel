'use client';

import { useId } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { markdownUrl } from './markdown';

function markdownComponents(prefix: string): Components {
  return {
    // Content headings live below the surrounding page/dialog and field headings.
    h1: ({ children }) => <h4 className="ui-markdown-heading-1">{children}</h4>,
    h2: ({ children, id, className = '' }) => (
      <h5
        id={id === 'footnote-label' ? `${prefix}footnote-label` : id}
        className={`ui-markdown-heading-2 ${className}`}
      >
        {children}
      </h5>
    ),
    h3: ({ children }) => <h6>{children}</h6>,
    h4: ({ children }) => <h6>{children}</h6>,
    h5: ({ children }) => <h6>{children}</h6>,
    h6: ({ children }) => <h6>{children}</h6>,
    img: ({ alt }) => <>{alt}</>,
    a: ({ node: _node, href, children, ...props }) => {
      if (!href) return <>{children}</>;
      const external = /^(?:https?:|[/\\]{2})/i.test(href);
      return (
        <a
          {...props}
          aria-describedby={
            props['aria-describedby'] === 'footnote-label'
              ? `${prefix}footnote-label`
              : props['aria-describedby']
          }
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          {children}
        </a>
      );
    },
    table: ({ children }) => (
      <div className="ui-markdown-scroll" role="region" aria-label="Table" tabIndex={0}>
        <table>{children}</table>
      </div>
    ),
    pre: ({ children }) => (
      <pre tabIndex={0} aria-label="Code block">
        {children}
      </pre>
    ),
  };
}

/** Read-only Markdown. The source stays in the feature's existing string field. */
export function MarkdownContent({
  source,
  className = '',
}: {
  source: string;
  className?: string;
}) {
  const id = useId();
  const prefix = `markdown-${id}-`;
  return (
    <div className={`ui-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        remarkRehypeOptions={{ clobberPrefix: prefix }}
        urlTransform={markdownUrl}
        components={markdownComponents(prefix)}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
