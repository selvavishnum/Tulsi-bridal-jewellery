/* Private / transactional page — kept out of search results. */
export const metadata = { title: 'Wishlist', robots: { index: false, follow: false } };

export default function Layout({ children }) {
  return children;
}
