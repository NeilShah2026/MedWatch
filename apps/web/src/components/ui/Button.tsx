import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark disabled:bg-primary/50',
  secondary:
    'border-2 border-primary bg-surface text-primary hover:bg-primary-light disabled:opacity-50',
  ghost: 'text-primary hover:bg-primary-light disabled:opacity-50',
  danger: 'bg-severity-high text-white hover:brightness-95 disabled:opacity-50',
  accent: 'bg-accent text-ink hover:brightness-95 disabled:opacity-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
  size?: 'md' | 'lg';
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    block,
    size = 'md',
    busy,
    className = '',
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={[
        'inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        'disabled:cursor-not-allowed',
        size === 'lg' ? 'py-3 text-lg' : 'py-2',
        block ? 'w-full' : '',
        VARIANTS[variant],
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});
