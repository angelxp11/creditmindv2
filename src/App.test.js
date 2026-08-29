import { render, screen } from '@testing-library/react';
import App from './App';

test('shows the loading state while auth is checked', () => {
  render(<App />);
  expect(screen.getByText(/verificando sesión/i)).toBeInTheDocument();
});
