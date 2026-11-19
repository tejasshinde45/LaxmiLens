import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';

describe('UI Component Library', () => {
  describe('Button', () => {
    it('renders with label and handles clicks', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);

      const btn = screen.getByRole('button', { name: /click me/i });
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('disables button when disabled or isLoading', () => {
      render(<Button disabled isLoading>Processing</Button>);
      const btn = screen.getByRole('button');
      expect(btn).toBeDisabled();
    });
  });

  describe('Badge', () => {
    it('renders text with correct variant styles', () => {
      render(<Badge variant="income" dot>+₹500.00</Badge>);
      const badge = screen.getByText('+₹500.00');
      expect(badge).toBeInTheDocument();
    });
  });

  describe('Input', () => {
    it('renders with label, error and handles change', () => {
      const handleChange = vi.fn();
      render(
        <Input
          id="test-input"
          label="Test Label"
          error="Test Error"
          onChange={handleChange}
        />
      );

      expect(screen.getByLabelText(/test label/i)).toBeInTheDocument();
      expect(screen.getByText(/test error/i)).toBeInTheDocument();

      const input = screen.getByLabelText(/test label/i);
      fireEvent.change(input, { target: { value: 'New Value' } });
      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe('SearchInput', () => {
    it('calls onClear when clear button is clicked', () => {
      const handleClear = vi.fn();
      render(
        <SearchInput
          value="sample query"
          onChange={() => {}}
          onClear={handleClear}
          placeholder="Search..."
        />
      );

      const clearBtn = screen.getByLabelText(/clear search/i);
      expect(clearBtn).toBeInTheDocument();
      fireEvent.click(clearBtn);
      expect(handleClear).toHaveBeenCalledTimes(1);
    });
  });
});
