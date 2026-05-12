import { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

export function Button({
  className,
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'primary' | 'danger' }) {
  const variants = {
    default: 'bg-panel border border-border hover:bg-[#1d1d1d]',
    ghost: 'bg-transparent hover:bg-panel',
    primary: 'bg-accent text-black hover:brightness-110 border border-accent',
    danger: 'bg-red-600/90 text-white hover:bg-red-600 border border-red-700'
  }
  return (
    <button
      className={cn(
        'no-drag inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'no-drag w-full rounded-md bg-panel border border-border px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-muted',
        className
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'no-drag w-full rounded-md bg-panel border border-border px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-muted resize-none font-mono',
        className
      )}
      {...props}
    />
  )
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-lg border border-border bg-panel', className)}>{children}</div>
}

export function Pill({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'open' | 'merged' | 'closed' | 'running' }) {
  const tones = {
    default: 'bg-[#222] text-muted',
    open: 'bg-green-900/40 text-green-300',
    merged: 'bg-purple-900/40 text-purple-300',
    closed: 'bg-red-900/40 text-red-300',
    running: 'bg-amber-900/40 text-amber-300'
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider', tones[tone])}>
      {children}
    </span>
  )
}
