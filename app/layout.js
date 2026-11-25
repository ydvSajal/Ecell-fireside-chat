import './styles.css';

export const metadata = {
  title: 'Corporate Innovation Action Lab',
  description: 'Live questions and responses for the E-Cell Action Lab.',
};

export default function Layout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
