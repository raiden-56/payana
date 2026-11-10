import { DestroyRef, Signal, computed, inject, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { ApiError, toApiError } from '../api/api-error';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LoadState<T> {
  status: LoadStatus;
  data: T | null;
  error: ApiError | null;
}

/**
 * One asynchronous read, as signals. Every screen that talks to the network
 * uses this so that loading, empty, error and retry are handled the same way
 * everywhere:
 *
 *   readonly drivers = loader(() => this.api.search(this.query()));
 *   ...
 *   @switch (drivers.status()) { @case ('loading') ... @case ('error') ... }
 *
 * A new load() cancels the previous one, so the last request always wins.
 */
export class Loader<T> {
  private readonly state = signal<LoadState<T>>({ status: 'idle', data: null, error: null });
  private subscription: Subscription | null = null;

  readonly status: Signal<LoadStatus> = computed(() => this.state().status);
  readonly data: Signal<T | null> = computed(() => this.state().data);
  readonly error: Signal<ApiError | null> = computed(() => this.state().error);
  readonly loading: Signal<boolean> = computed(() => this.state().status === 'loading');
  /** True while reloading with earlier data still on screen. */
  readonly refreshing: Signal<boolean> = computed(
    () => this.state().status === 'loading' && this.state().data !== null,
  );

  constructor(
    private readonly source: () => Observable<T>,
    destroyRef: DestroyRef,
  ) {
    destroyRef.onDestroy(() => this.subscription?.unsubscribe());
  }

  /**
   * Starts (or restarts) the read.
   * `silent` keeps the current data and status on screen while refetching -
   * used for polling, so the page does not flash a skeleton every few seconds.
   */
  load(options: { silent?: boolean } = {}): void {
    this.subscription?.unsubscribe();
    if (!options.silent || this.state().status === 'idle') {
      this.state.update((s) => ({ ...s, status: 'loading', error: null }));
    }
    this.subscription = this.source().subscribe({
      next: (data) => this.state.set({ status: 'ready', data, error: null }),
      error: (error: unknown) => {
        // A failed background refresh keeps showing what we already have.
        if (options.silent && this.state().data !== null) return;
        this.state.update((s) => ({ ...s, status: 'error', error: toApiError(error) }));
      },
    });
  }

  /** Replace the data without a request (after a mutation returned the new value). */
  set(data: T): void {
    this.state.set({ status: 'ready', data, error: null });
  }

  /** Apply a change to the current data, if there is any. */
  update(change: (current: T) => T): void {
    const current = this.state().data;
    if (current !== null) this.set(change(current));
  }
}

/** Create a Loader tied to the lifetime of the calling component or service. */
export function loader<T>(source: () => Observable<T>): Loader<T> {
  return new Loader(source, inject(DestroyRef));
}
