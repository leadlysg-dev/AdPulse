import { useEffect } from 'react';
import DemoContext from './DemoContext';
import Shell from '../components/Shell';

// Route root for /demo and /demo/*: marks the tree as demo and keeps the
// page out of search indexes while mounted. Everything inside is the real
// dashboard shell rendering the real tab components - the demo differences
// live in the request adapter and the shell's isDemo branches, not here.
export default function DemoPage({ title, children }) {
  useEffect(() => {
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = 'noindex';
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  return (
    <DemoContext.Provider value={true}>
      <Shell title={title}>{children}</Shell>
    </DemoContext.Provider>
  );
}
