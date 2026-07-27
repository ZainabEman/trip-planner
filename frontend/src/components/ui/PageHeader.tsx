interface PageHeaderProps {
  title: string;
  intro: string;
}

/** Shared heading block for the static content pages. */
export function PageHeader({ title, intro }: PageHeaderProps) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-2 text-base leading-relaxed text-slate-600">{intro}</p>
    </div>
  );
}
