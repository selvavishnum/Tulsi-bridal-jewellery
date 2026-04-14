export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  loading = false,
  ...props
}) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition disabled:opacity-60 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-maroon-950 text-white hover:bg-maroon-900',
    secondary: 'bg-gold-600 text-white hover:bg-gold-700',
    outline: 'border-2 border-maroon-950 text-maroon-950 hover:bg-maroon-950 hover:text-white',
    ghost: 'text-maroon-950 hover:bg-maroon-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-5 py-2.5 text-sm', lg: 'px-7 py-3 text-base' };

  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}
