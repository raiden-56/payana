import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AccountRole,
  ConversionEvent,
  ErrorCode,
  OTP_LENGTH,
  type Me,
  type OtpChallenge,
  type SignInIntent,
} from '@payana/contracts';
import { AnalyticsService } from '@core/analytics/analytics.service';
import { ApiError, toApiError } from '@core/api/api-error';
import { AuthStore, maskPhone } from '@core/auth/auth.store';
import { safeReturnUrl } from '@core/auth/guards';
import { BRAND } from '@core/brand';
import { describeDevice } from '@core/platform/platform';
import { ToastService } from '@core/util/toast.service';
import { Icon } from '@ui/icon';
import { VehicleArt } from '@ui/vehicle-art';
import { Photo } from '@ui/photo';

/** An account created in the last two minutes counts as a new sign-up for conversion reporting. */
const NEW_ACCOUNT_WINDOW_MS = 120_000;

/**
 * Phone + one-time code sign-in for customers and drivers.
 * Step 1 asks for the number, step 2 for the 6-digit code.
 */
@Component({
  selector: 'app-sign-in',
  imports: [ReactiveFormsModule, RouterLink, Icon, VehicleArt, Photo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.scss',
})
export class SignIn {
  /** From the query string (?intent=driver&returnUrl=/bookings). */
  readonly intent = input<string>();
  readonly returnUrl = input<string>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsService);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly brand = BRAND;
  protected readonly otpLength = OTP_LENGTH;

  protected readonly phone = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)],
  });
  protected readonly code = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(new RegExp(`^\\d{${OTP_LENGTH}}$`))],
  });

  protected readonly chosenIntent = signal<SignInIntent | null>(null);
  protected readonly asDriver = computed(() => (this.chosenIntent() ?? this.intent()) === 'driver');
  protected readonly challenge = signal<OtpChallenge | null>(null);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string>('');
  protected readonly resendIn = signal(0);
  protected readonly lockedFor = signal(0);
  protected readonly maskedPhone = computed(() => maskPhone('+91' + this.phone.value));

  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.stopTimer());
  }

  protected setIntent(intent: SignInIntent): void {
    this.chosenIntent.set(intent);
  }

  /** Keep only digits; people paste "+91 98765 43210" and "098765 43210". */
  protected onPhoneInput(): void {
    let digits = this.phone.value.replace(/\D/g, '');
    if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
    if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
    this.phone.setValue(digits.slice(0, 10), { emitEvent: false });
  }

  protected onCodeInput(): void {
    const digits = this.code.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    this.code.setValue(digits, { emitEvent: false });
    // Submitting on the last digit saves a tap, and SMS autofill lands here too.
    if (digits.length === OTP_LENGTH && !this.busy()) this.verify();
  }

  protected sendCode(): void {
    this.phone.markAsTouched();
    if (this.phone.invalid || this.busy() || this.lockedFor() > 0) return;
    this.busy.set(true);
    this.problem.set('');

    this.auth.requestOtp({ phone: '+91' + this.phone.value, intent: this.asDriver() ? 'driver' : 'customer' }).subscribe({
      next: (challenge) => {
        this.busy.set(false);
        this.challenge.set(challenge);
        this.code.reset('');
        this.startCountdown(this.resendIn, challenge.resendAfterSeconds);
        queueMicrotask(() => this.codeInput()?.nativeElement.focus());
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.showProblem(toApiError(error));
      },
    });
  }

  protected verify(): void {
    const challenge = this.challenge();
    this.code.markAsTouched();
    if (!challenge || this.code.invalid || this.busy()) return;
    this.busy.set(true);
    this.problem.set('');

    this.auth
      .verifyOtp({
        challengeId: challenge.challengeId,
        code: this.code.value,
        intent: this.asDriver() ? 'driver' : 'customer',
        deviceLabel: describeDevice(),
      })
      .subscribe({
        next: (me) => this.onSignedIn(me),
        error: (error: unknown) => {
          this.busy.set(false);
          const apiError = toApiError(error);
          this.showProblem(apiError);
          // A dead challenge cannot be retried: go back for a fresh code.
          if (apiError.is(ErrorCode.OtpExpired) || apiError.is(ErrorCode.OtpAttemptsExceeded)) {
            this.challenge.set(null);
          } else {
            this.code.reset('');
            this.codeInput()?.nativeElement.focus();
          }
        },
      });
  }

  protected changeNumber(): void {
    this.challenge.set(null);
    this.problem.set('');
    this.stopTimer();
    this.resendIn.set(0);
  }

  protected useDevCode(): void {
    const dev = this.challenge()?.devCode;
    if (!dev) return;
    this.code.setValue(dev);
    this.verify();
  }

  private onSignedIn(me: Me): void {
    const isNew = Date.now() - new Date(me.createdAt).getTime() < NEW_ACCOUNT_WINDOW_MS;
    const role = this.asDriver() ? 'driver' : 'customer';
    this.analytics.track(isNew ? 'sign_up' : 'login', { method: 'phone_otp', role });
    if (isNew) {
      this.analytics.conversion(this.asDriver() ? ConversionEvent.DriverSignUp : ConversionEvent.CustomerSignUp);
    }
    this.toasts.success(isNew ? `Welcome to ${BRAND.name}.` : 'You are signed in.');

    const target =
      safeReturnUrl(this.returnUrl()) ??
      (this.asDriver() && me.roles.includes(AccountRole.Driver)
        ? me.driver?.onboardingComplete
          ? '/partner'
          : '/partner/onboarding'
        : '/');
    void this.router.navigateByUrl(target);
  }

  private showProblem(error: ApiError): void {
    this.problem.set(error.message);
    const wait = error.retryAfterSeconds;
    if (wait && (error.is(ErrorCode.RateLimited) || error.is(ErrorCode.AccountLocked))) {
      this.startCountdown(this.lockedFor, wait);
    }
  }

  /** One ticking interval drives whichever countdown is running. */
  private startCountdown(target: typeof this.resendIn, seconds: number): void {
    target.set(Math.max(0, Math.ceil(seconds)));
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.resendIn.update((s) => Math.max(0, s - 1));
      this.lockedFor.update((s) => Math.max(0, s - 1));
      if (this.resendIn() === 0 && this.lockedFor() === 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
