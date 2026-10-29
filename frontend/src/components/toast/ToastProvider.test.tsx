import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from './ToastProvider';
import { useToast } from './toast-context';

function Trigger() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success('Saved it')}>ok</button>
      <button onClick={() => toast.error('It broke')}>bad</button>
    </>
  );
}

describe('toasts', () => {
  it('announces success politely and errors as alerts, and can be dismissed', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText('ok'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved it');
    await userEvent.click(screen.getByText('bad'));
    expect(screen.getByRole('alert')).toHaveTextContent('It broke');
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[1]!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
