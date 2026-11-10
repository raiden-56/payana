import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { UPLOAD_MAX_BYTES } from '@payana/contracts';
import { Icon } from '@ui/icon';
import { uploadProblem } from '../partner-logic';

let nextId = 0;

/**
 * File chooser that checks type and size before anything is uploaded, so a
 * driver on mobile data does not wait for an upload that would be refused.
 * It only picks files; the parent decides when to upload them.
 */
@Component({
  selector: 'app-file-pick',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="drop" [class.has-file]="!!names()" [class.is-invalid]="!!problem()" [for]="inputId">
      <span class="drop__icon"><app-icon [name]="names() ? 'check' : 'upload'" [size]="20" /></span>
      <span class="drop__text">
        <strong>{{ names() || label() }}</strong>
        <small>{{ hint() }}</small>
      </span>
      <span class="btn btn--outline btn--sm drop__btn" aria-hidden="true">{{ names() ? 'Change' : 'Choose' }}</span>
    </label>
    <input
      class="visually-hidden"
      type="file"
      [id]="inputId"
      [accept]="accept()"
      [multiple]="multiple()"
      [disabled]="disabled()"
      [attr.aria-describedby]="problem() ? inputId + '-err' : null"
      [attr.aria-invalid]="problem() ? 'true' : null"
      (change)="onChange($event)"
    />
    @if (problem()) {
      <p class="field__error" [id]="inputId + '-err'" role="alert"><app-icon name="alert-circle" [size]="14" /> {{ problem() }}</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.35rem;
      min-width: 0;
    }
    .drop {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      min-height: 3.6rem;
      padding: 0.6rem 0.75rem;
      border: var(--stroke) dashed var(--ink-400);
      border-radius: var(--r-md);
      background: var(--sand-0);
      cursor: pointer;
      transition:
        border-color var(--dur-2) var(--ease-out),
        background-color var(--dur-2) var(--ease-out);
    }
    .drop:hover {
      border-color: var(--ink-900);
      background: var(--marigold-50);
    }
    /* The real input is visually hidden; show its focus on the label instead. */
    .drop:has(+ input:focus-visible) {
      outline: 2.5px solid var(--color-focus);
      outline-offset: 2px;
    }
    .drop.has-file {
      border-style: solid;
      border-color: var(--palm-600);
      background: var(--palm-50);
    }
    .drop.is-invalid {
      border-color: var(--color-danger);
      background: var(--crimson-50);
    }
    .drop__icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 2.4rem;
      height: 2.4rem;
      border-radius: 50%;
      background: var(--sand-200);
      color: var(--ink-800);
    }
    .has-file .drop__icon {
      background: var(--palm-600);
      color: var(--sand-0);
    }
    .drop__text {
      display: grid;
      flex: 1;
      min-width: 0;
      line-height: 1.3;
    }
    .drop__text strong {
      font-weight: 650;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .drop__text small {
      font-size: var(--fs-xs);
      color: var(--color-text-subtle);
    }
    .drop__btn {
      flex: none;
    }
  `,
})
export class FilePick {
  readonly label = input('Choose a file');
  /** Allowed MIME types. */
  readonly types = input.required<readonly string[]>();
  readonly multiple = input(false);
  readonly maxFiles = input(1);
  readonly disabled = input(false);
  /** Valid files only. An empty array means the selection was cleared or refused. */
  readonly picked = output<File[]>();

  protected readonly inputId = `file-pick-${nextId++}`;
  protected readonly problem = signal('');
  private readonly chosen = signal<File[]>([]);

  protected readonly accept = computed(() => this.types().join(','));
  protected readonly names = computed(() => {
    const files = this.chosen();
    if (!files.length) return '';
    return files.length === 1 ? files[0]!.name : `${files.length} files chosen`;
  });
  protected readonly hint = computed(() => {
    const kinds = this.types().map((t) => (t === 'application/pdf' ? 'PDF' : t.replace('image/', '').toUpperCase()));
    const limit = `${Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024))} MB`;
    return `${kinds.join(', ')} · up to ${limit}${this.multiple() ? ` each · ${this.maxFiles()} at most` : ''}`;
  });

  /** Forget the current selection (after a successful upload). */
  reset(): void {
    this.chosen.set([]);
    this.problem.set('');
  }

  protected onChange(event: Event): void {
    const el = event.target as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    // Allow picking the same file again after a failed attempt.
    el.value = '';
    if (!files.length) return;

    if (files.length > this.maxFiles()) {
      this.refuse(`Choose at most ${this.maxFiles()} file${this.maxFiles() === 1 ? '' : 's'}.`);
      return;
    }
    for (const file of files) {
      const problem = uploadProblem(file, this.types());
      if (problem) {
        this.refuse(files.length > 1 ? `${file.name}: ${problem}` : problem);
        return;
      }
    }
    this.problem.set('');
    this.chosen.set(files);
    this.picked.emit(files);
  }

  private refuse(message: string): void {
    this.problem.set(message);
    this.chosen.set([]);
    this.picked.emit([]);
  }
}
