import {
  DestroyRef,
  Directive,
  ElementRef,
  NgZone,
  afterNextRender,
  effect,
  inject,
  input,
} from '@angular/core';
import { prefersReducedMotion } from '@core/platform/platform';

export type RevealStyle = 'up' | 'left' | 'right' | 'scale' | 'fade';

/**
 * Scroll reveal: the element fades and slides into place the first time it
 * enters the viewport.
 *
 *   <article appReveal>                       rises in
 *   <div appReveal="left" [revealDelay]="120"> slides from the left, 120 ms late
 *
 * Progressive: the hidden state is applied by this directive at run time, so
 * without JavaScript - and under prefers-reduced-motion - content is simply
 * visible. Styles live in styles/_motion.scss.
 */
@Directive({ selector: '[appReveal]' })
export class Reveal {
  readonly appReveal = input<RevealStyle | ''>('');
  /** Milliseconds to wait after entering the viewport. Use for staggered lists. */
  readonly revealDelay = input(0);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;

      // Already on screen at first paint (above the fold): leave it alone
      // rather than hiding content the visitor is looking at.
      const rect = this.el.getBoundingClientRect();
      const alreadyVisible = rect.top < window.innerHeight * 0.92 && rect.bottom > 0;

      const style = this.appReveal() || 'up';
      this.el.classList.add('reveal');
      if (style !== 'up') this.el.classList.add(`reveal--${style}`);
      if (this.revealDelay()) this.el.style.setProperty('--reveal-delay', `${this.revealDelay()}ms`);

      if (alreadyVisible) {
        // Two frames so the hidden state is painted once and the entrance animates.
        requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.add('is-revealed')));
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            this.el.classList.add('is-revealed');
            observer.disconnect();
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
      );
      observer.observe(this.el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}

/**
 * Scroll-linked progress. While the element is near the viewport this writes
 * two CSS custom properties on it, updated once per animation frame:
 *
 *   --p     0 → 1 as the element travels from entering at the bottom of the
 *           viewport to leaving at the top.
 *   --exit  0 → 1 as the element's top edge scrolls from the top of the
 *           viewport to a full element-height above it (hero parallax).
 *
 * Styles decide what to do with them (draw a path, shift a layer). Nothing is
 * written under prefers-reduced-motion, so styles fall back to their defaults.
 */
@Directive({ selector: '[appScrollProgress]' })
export class ScrollProgress {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;

      let frame = 0;
      let active = false;

      const update = () => {
        frame = 0;
        const rect = this.el.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const p = clamp01((vh - rect.top) / (vh + rect.height));
        const exit = clamp01(-rect.top / Math.max(rect.height, 1));
        this.el.style.setProperty('--p', p.toFixed(4));
        this.el.style.setProperty('--exit', exit.toFixed(4));
      };
      const schedule = () => {
        if (active && !frame) frame = requestAnimationFrame(update);
      };

      // Scroll work stays outside Angular: it must not trigger change detection.
      this.zone.runOutsideAngular(() => {
        const observer = new IntersectionObserver(
          (entries) => {
            active = entries.some((e) => e.isIntersecting);
            schedule();
          },
          { rootMargin: '10% 0px 10% 0px' },
        );
        observer.observe(this.el);
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule, { passive: true });
        update();

        destroyRef.onDestroy(() => {
          observer.disconnect();
          window.removeEventListener('scroll', schedule);
          window.removeEventListener('resize', schedule);
          if (frame) cancelAnimationFrame(frame);
        });
      });
    });
  }
}

/**
 * Counts a number up from zero the first time it scrolls into view.
 *
 *   <span [appCountUp]="driverCount()"></span>
 *
 * The final value is always what ends up in the DOM; with reduced motion it is
 * written immediately.
 */
@Directive({ selector: '[appCountUp]' })
export class CountUp {
  readonly appCountUp = input.required<number>();
  readonly countDuration = input(1100);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private seen = false;
  private frame = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const format = new Intl.NumberFormat('en-IN');

    const render = (value: number) => (this.el.textContent = format.format(Math.round(value)));

    const run = (target: number) => {
      cancelAnimationFrame(this.frame);
      if (prefersReducedMotion() || target <= 0) {
        render(target);
        return;
      }
      const start = performance.now();
      const duration = this.countDuration();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        render(target * (1 - Math.pow(1 - t, 3)));
        if (t < 1) this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    };

    // The value often arrives from the API after the element is already on screen.
    effect(() => {
      const target = this.appCountUp();
      if (this.seen) run(target);
      else render(0);
    });

    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.seen = true;
        run(this.appCountUp());
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.seen = true;
          run(this.appCountUp());
          observer.disconnect();
        }
      });
      observer.observe(this.el);
      destroyRef.onDestroy(() => {
        observer.disconnect();
        cancelAnimationFrame(this.frame);
      });
    });
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 3D tilt toward the pointer, with the spotlight position for `.spot`.
 *
 *   <a class="card tilt spot" appTilt>…</a>
 *
 * Writes --rx / --ry (rotation) and --mx / --my (pointer position) on the
 * element. Mouse and pen only: touch screens and reduced-motion get none of it.
 */
@Directive({ selector: '[appTilt]' })
export class Tilt {
  /** Maximum rotation in degrees. */
  readonly appTilt = input<number | string>('');

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (prefersReducedMotion() || !globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
      const max = Number(this.appTilt()) || 6;
      let frame = 0;
      let last: PointerEvent | null = null;

      const apply = () => {
        frame = 0;
        if (!last) return;
        const r = this.el.getBoundingClientRect();
        const x = (last.clientX - r.left) / r.width;
        const y = (last.clientY - r.top) / r.height;
        this.el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        this.el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
        this.el.style.setProperty('--ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
        this.el.style.setProperty('--rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
      };
      const move = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return;
        last = e;
        this.el.classList.add('is-tilting');
        if (!frame) frame = requestAnimationFrame(apply);
      };
      const leave = () => {
        last = null;
        this.el.classList.remove('is-tilting');
        this.el.style.setProperty('--rx', '0deg');
        this.el.style.setProperty('--ry', '0deg');
      };

      this.zone.runOutsideAngular(() => {
        this.el.addEventListener('pointermove', move, { passive: true });
        this.el.addEventListener('pointerleave', leave);
      });
      destroyRef.onDestroy(() => {
        this.el.removeEventListener('pointermove', move);
        this.el.removeEventListener('pointerleave', leave);
        if (frame) cancelAnimationFrame(frame);
      });
    });
  }
}

/**
 * Parallax: the element drifts at its own speed as the page scrolls.
 *
 *   <app-photo appParallax="0.15" />      moves up 15 % slower than the page
 *   <div appParallax="-0.1">              moves against the scroll
 *
 * The offset is measured from the viewport centre, so an element sits in its
 * natural place when centred on screen. Pixel offsets are capped; nothing
 * moves under prefers-reduced-motion.
 */
@Directive({ selector: '[appParallax]' })
export class Parallax {
  readonly appParallax = input<number | string>(0.12);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;
      const speed = Number(this.appParallax()) || 0;
      let visible = false;
      let frame = 0;

      const update = () => {
        frame = 0;
        const r = this.el.getBoundingClientRect();
        // Measure the untransformed box: undo our own translation first.
        const current = Number(this.el.dataset['plx'] ?? 0);
        const centre = r.top - current + r.height / 2;
        const offset = Math.max(-220, Math.min(220, (centre - window.innerHeight / 2) * -speed));
        this.el.dataset['plx'] = offset.toFixed(1);
        this.el.style.translate = `0 ${offset.toFixed(1)}px`;
      };
      const schedule = () => {
        if (visible && !frame) frame = requestAnimationFrame(update);
      };

      this.zone.runOutsideAngular(() => {
        const io = new IntersectionObserver((e) => {
          visible = e.some((x) => x.isIntersecting);
          schedule();
        }, { rootMargin: '20% 0px' });
        io.observe(this.el);
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule, { passive: true });
        this.el.style.willChange = 'translate';
        update();
        destroyRef.onDestroy(() => {
          io.disconnect();
          window.removeEventListener('scroll', schedule);
          window.removeEventListener('resize', schedule);
          if (frame) cancelAnimationFrame(frame);
        });
      });
    });
  }
}
