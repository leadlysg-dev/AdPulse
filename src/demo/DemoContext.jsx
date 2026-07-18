import { createContext, useContext } from 'react';

// True only under the /demo routes. The default is false and no provider
// exists outside DemoPage, so authenticated pages read false everywhere
// and behave exactly as before.
const DemoContext = createContext(false);
export const useDemo = () => useContext(DemoContext);
export default DemoContext;
