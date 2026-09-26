/* Private / transactional page — kept out of search results. */
export const metadata = { title: 'My Account', robots: { index: false, follow: false } };

export default function Layout({ children }) {
  return children;
}
