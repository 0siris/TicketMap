import { createContext, useContext, useEffect, useRef, useState, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import type { GitLabTarget } from '../shared/types.js';
import { gitLabImage } from '../shared/images.js';
import { safeGitLabUrl, safeMarkdownUrl } from './api.js';

const ImageLink = createContext<string | undefined>(undefined);
export function MarkdownLink({ children, href, node }: ComponentProps<'a'> & ExtraProps) {
  if (node?.children.some(child => child.type === 'element' && child.tagName === 'img'))
    return <ImageLink.Provider value={href}><span>{children}</span></ImageLink.Provider>;
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

export function TicketImage({ src, alt, issueUrl, target }: {
  src?: string; alt?: string; issueUrl: string; target: GitLabTarget;
}) {
  const attachment = gitLabImage(src, target);
  const linkedUrl = useContext(ImageLink);
  const external = safeMarkdownUrl(src, issueUrl);
  const [visible, setVisible] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { root: element.closest('.editor-content') });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const load = visible && (attachment || allowed);
  const label = alt || 'Bildanhang';
  return <span className={`ticket-image ${state}`} ref={container}>
    {load && state !== 'error' && <img src={attachment?.src ?? external} alt={label} loading="lazy" decoding="async"
      referrerPolicy="no-referrer" onLoad={() => setState('loaded')} onError={() => setState('error')} />}
    {state !== 'loaded' && <span className="image-status" role="status">
      {state === 'error' ? `Bild konnte nicht geladen werden: ${label}`
        : attachment || allowed ? `${label} – ${visible ? 'Bild wird geladen …' : 'Bild wird beim Scrollen geladen'}`
          : `${label} – externes Bild`}
    </span>}
    {!attachment && external && !allowed && <button type="button" onClick={() => setAllowed(true)}>
      Externes Bild laden
    </button>}
    <a className="image-link" href={linkedUrl ?? attachment?.href ?? safeGitLabUrl(issueUrl, target.gitlabUrl)} target="_blank" rel="noreferrer">
      {linkedUrl ? 'Link öffnen' : 'In GitLab öffnen'}
    </a>
  </span>;
}
