/* Private / transactional page — kept out of search results. */
export const metadata = { title: 'Order placed', robots: { index: false, follow: false } };

export default function Layout({ children }) {
  return children;
}
