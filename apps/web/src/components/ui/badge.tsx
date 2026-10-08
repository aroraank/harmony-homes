import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold tracking-wide', {
  variants: {
    variant: {
      default: 'bg-primary/12 text-primary',
      secondary: 'bg-secondary text-secondary-foreground',
      outline: 'border text-foreground',
      success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
      warning: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
      danger: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
      info: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
      muted: 'bg-muted text-muted-foreground',
      lime: 'bg-lime-200 text-lime-900 dark:bg-lime-400/20 dark:text-lime-200',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
