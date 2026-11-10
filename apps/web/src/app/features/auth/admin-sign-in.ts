import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { OTP_LENGTH } from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { toApiError } from '@core/api/api-error';
import { AuthStore } from '@core/auth/auth.store';
import { safeReturnUrl } from '@core/auth/guards';
import { BRAND } from '@core/brand';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';

type Step = 'password' | 'mfa' | 'enrol';

/**
 * Administrator sign-in: e-mail and password, then a time-based code from an
 * authenticator app. Roles that must use MFA are walked through enrolment on
 * their first sign-in. The server decides which step comes next.
 */
@Component({
  selector: 'app-admin-sign-in',
  imports: [ReactiveFormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sign-in.scss',
  template: `
    <section class="auth">
      <div class="auth__form">
        <div class="auth__card">
          <header class="auth__head">
            <span class="eyebrow">{{ brand.name }} staff</span>
            @switch (step()) {
              @case ('password') {
                <h1>Admin console</h1>
                <p class="muted">Staff accounts only. Travellers and drivers <a class="link" routerLink="/sign-in">sign in here</a>.</p>
              }
              @case ('enrol') {
                <h1>Set up two-step sign-in</h1>
                <p class="muted">Your role requires an authenticator app. This takes a minute and is done once.</p>
              }
              @default {
                <h1>Enter your code</h1>
                <p class="muted">Open your authenticator app and type the current {{ otpLength }}-digit code for {{ brand.name }}.</p>
              }
            }
          </header>

          @if (step() === 'password') {
            <form [formGroup]="credentials" (submit)="$event.preventDefault(); signIn()" novalidate>
              <div class="field">
                <label class="field__label" for="email">Work e-mail</label>
                <input id="email" class="input" type="email" autocomplete="username" formControlName="email" [attr.aria-invalid]="invalid('email')" />
                @if (invalid('email')) {
                  <p class="field__error"><app-icon name="alert-circle" [size]="14" /> Enter your e-mail address.</p>
                }
              </div>
              <div class="field">
                <label class="field__label" for="password">Password</label>
                <input id="password" class="input" type="password" autocomplete="current-password" formControlName="password" [attr.aria-invalid]="invalid('password')" />
                @if (invalid('password')) {
                  <p class="field__error"><app-icon name="alert-circle" [size]="14" /> Enter your password.</p>
                }
              </div>
              @if (problem()) {
                <p class="notice notice--danger" role="alert"><app-icon name="alert-circle" [size]="18" /> <span>{{ problem() }}</span></p>
              }
              <button type="submit" class="btn btn--dark btn--lg btn--block" [class.is-loading]="busy()" [disabled]="busy()">
                <app-icon name="lock" [size]="18" /> Continue
              </button>
            </form>
          } @else {
            @if (step() === 'enrol') {
              <div class="setup">
                <ol>
                  <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…).</li>
                  <li>Add an account by entering this setup key by hand, or open the link on the phone that has the app.</li>
                  <li>Type the 6-digit code the app shows below.</li>
                </ol>
                <div class="setup__key">
                  <code>{{ secret() }}</code>
                  <button type="button" class="btn btn--outline btn--sm" (click)="copySecret()"><app-icon name="copy" [size]="15" /> Copy key</button>
                  <a class="link" [href]="otpauthUrl()">Open in authenticator</a>
                </div>
              </div>
            }
            <form (submit)="$event.preventDefault(); verify()" novalidate>
              <div class="field">
                <label class="field__label" for="totp">Authenticator code</label>
                <input
                  #totpInput
                  id="totp"
                  class="input code"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  [attr.maxlength]="otpLength"
                  [formControl]="totp"
                  (input)="onTotpInput()"
                />
              </div>
              @if (problem()) {
                <p class="notice notice--danger" role="alert"><app-icon name="alert-circle" [size]="18" /> <span>{{ problem() }}</span></p>
              }
              <button type="submit" class="btn btn--dark btn--lg btn--block" [class.is-loading]="busy()" [disabled]="busy()">Verify and sign in</button>
            </form>
            <p class="auth__resend"><button type="button" class="link" (click)="restart()">Start again</button></p>
          }
        </div>
      </div>

      <aside class="auth__art" aria-hidden="true">
        <span class="auth__sun"></span>
        <svg viewBox="0 0 200 200" width="260" style="position: relative">
          <path d="M100 18c26 22 52 30 76 30v52c0 44-30 70-76 86-46-16-76-42-76-86V48c24 0 50-8 76-30z" fill="#fdf8ee" stroke="#1f1a14" stroke-width="6" stroke-linejoin="round" />
          <path d="M66 102l24 24 46-50" fill="none" stroke="#27624a" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <p>Every action here is logged.</p>
      </aside>
    </section>
  `,
})
export class AdminSignIn {
  readonly returnUrl = input<string>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly brand = BRAND;
  protected readonly otpLength = OTP_LENGTH;

  protected readonly credentials = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected readonly totp = new FormControl('', { nonNullable: true });

  protected readonly step = signal<Step>('password');
  protected readonly busy = signal(false);
  protected readonly problem = signal('');
  protected readonly secret = signal('');
  protected readonly otpauthUrl = signal('');
  private mfaToken = '';

  private readonly totpInput = viewChild<ElementRef<HTMLInputElement>>('totpInput');

  protected invalid(name: 'email' | 'password'): 'true' | null {
    const control = this.credentials.controls[name];
    return control.touched && control.invalid ? 'true' : null;
  }

  protected signIn(): void {
    this.credentials.markAllAsTouched();
    if (this.credentials.invalid || this.busy()) return;
    this.busy.set(true);
    this.problem.set('');

    this.auth.adminLogin(this.credentials.getRawValue()).subscribe({
      next: (response) => {
        this.busy.set(false);
        // The password is no longer needed in memory once the server has answered.
        this.credentials.controls.password.reset('');
        switch (response.status) {
          case 'authenticated':
            this.done();
            break;
          case 'mfa_required':
            this.mfaToken = response.mfaToken;
            this.step.set('mfa');
            this.focusCode();
            break;
          case 'mfa_enrollment_required':
            this.mfaToken = response.mfaToken;
            this.secret.set(response.secret);
            this.otpauthUrl.set(response.otpauthUrl);
            this.step.set('enrol');
            this.focusCode();
            break;
        }
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const e = toApiError(error);
        this.problem.set(e.retryAfterSeconds ? `${e.message} Try again in ${Math.ceil(e.retryAfterSeconds / 60)} min.` : e.message);
      },
    });
  }

  protected onTotpInput(): void {
    const digits = this.totp.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    this.totp.setValue(digits, { emitEvent: false });
    if (digits.length === OTP_LENGTH && !this.busy()) this.verify();
  }

  protected verify(): void {
    if (this.totp.value.length !== OTP_LENGTH || this.busy()) return;
    this.busy.set(true);
    this.problem.set('');
    this.auth.adminMfaVerify({ mfaToken: this.mfaToken, code: this.totp.value }).subscribe({
      next: () => this.done(),
      error: (error: unknown) => {
        this.busy.set(false);
        this.problem.set(toApiError(error).message);
        this.totp.reset('');
        this.focusCode();
      },
    });
  }

  protected restart(): void {
    this.step.set('password');
    this.problem.set('');
    this.totp.reset('');
    this.mfaToken = '';
    this.secret.set('');
  }

  protected copySecret(): void {
    void navigator.clipboard?.writeText(this.secret()).then(
      () => this.toasts.success('Setup key copied.'),
      () => this.toasts.error('Could not copy. Select the key and copy it by hand.'),
    );
  }

  private done(): void {
    this.analytics.track('login', { method: 'admin_password', role: 'admin' });
    void this.router.navigateByUrl(safeReturnUrl(this.returnUrl()) ?? '/admin');
  }

  private focusCode(): void {
    setTimeout(() => this.totpInput()?.nativeElement.focus());
  }
}
