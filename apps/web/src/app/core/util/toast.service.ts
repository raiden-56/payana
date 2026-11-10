import { Injectable, signal } from '@angular/core';
import { errorMessage } from '../api/api-error';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

/** Short, non-blocking confirmations. Rendered by <app-toast-host> in the shell. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly list = signal<Toast[]>([]);
  readonly toasts = this.list.asReadonly();

  success(message: string): void {
    this.push('success', message, 4000);
  }

  info(message: string): void {
    this.push('info', message, 4500);
  }

  /** Accepts a message or any thrown value (ApiError, HttpErrorResponse, ...). */
  error(error: unknown): void {
    this.push('error', typeof error === 'string' ? error : errorMessage(error), 6500);
  }

  dismiss(id: number): void {
    this.list.update((items) => items.filter((t) => t.id !== id));
  }

  private push(tone: ToastTone, message: string, ttlMs: number): void {
    const id = this.nextId++;
    // Keep at most three on screen; the oldest gives way.
    this.list.update((items) => [...items.slice(-2), { id, tone, message }]);
    setTimeout(() => this.dismiss(id), ttlMs);
  }
}
