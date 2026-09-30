import { Component, inject, signal, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { SplashItem } from '../../../core/services/splash.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import { normalizeNbsp } from '../../utils/normalize-nbsp';
import { substituteTerms } from '../../utils/substitute-terms';

export interface SplashDialogData {
  item: SplashItem;
  /** Total unseen splash items still queued, including this one. */
  remaining: number;
}

// Bright, high-contrast red/white/blue — the flag-blue (#3C3B6E) was too close
// to the night-sky background to read as "blue" against it.
const PATRIOTIC_COLORS = ['#FF3B30', '#FFFFFF', '#3B82F6'];

interface Particle {
  id: number;
  angle: string;
  dist: string;
  color: string;
}

interface Burst {
  id: number;
  x: number;
  y: number;
  particles: Particle[];
}

const MAX_VISIBLE_BURSTS = 8;
const BURST_INTERVAL_MS = 550;

// The card sits centered over the sky and is opaque, so a burst landing under
// it is invisible. Keep spawn points in a perimeter around that center zone.
function randomSpawnPoint(): { x: number; y: number } {
  const region = Math.floor(Math.random() * 4);
  switch (region) {
    case 0:
      return { x: Math.random() * 100, y: 2 + Math.random() * 18 }; // top strip
    case 1:
      return { x: Math.random() * 100, y: 80 + Math.random() * 18 }; // bottom strip
    case 2:
      return { x: 2 + Math.random() * 24, y: Math.random() * 100 }; // left strip
    default:
      return { x: 74 + Math.random() * 24, y: Math.random() * 100 }; // right strip
  }
}

function buildBurst(id: number): Burst {
  const { x, y } = randomSpawnPoint();
  return {
    id,
    x,
    y,
    particles: Array.from({ length: 20 }, (_, j) => ({
      id: j,
      angle: `${(360 / 20) * j + Math.random() * 12}deg`,
      dist: `${60 + Math.random() * 70}px`,
      color: PATRIOTIC_COLORS[Math.floor(Math.random() * PATRIOTIC_COLORS.length)],
    })),
  };
}

@Component({
  selector: 'app-splash',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <div class="splash" [class.patriotic]="isPatriotic">
      @if (isPatriotic) {
        <div class="fireworks">
          @for (burst of bursts(); track burst.id) {
            <div class="burst" [style.left.%]="burst.x" [style.top.%]="burst.y">
              @for (p of burst.particles; track p.id) {
                <span
                  class="particle"
                  [style.--angle]="p.angle"
                  [style.--dist]="p.dist"
                  [style.background]="p.color"
                  [style.color]="p.color"
                ></span>
              }
            </div>
          }
        </div>
      }

      <div class="splash-card">
        @if (data.remaining > 1) {
          <div class="splash-counter">+{{ data.remaining - 1 }} more waiting</div>
        }

        @switch (data.item.kind) {
          @case ('achievement') {
            <div class="splash-icon">
              @if (data.item.achievement.imagePath) {
                <img [src]="data.item.achievement.imagePath" [alt]="data.item.achievement.name" />
              } @else if (isImgIcon(data.item.achievement.icon)) {
                <img
                  [src]="imgIconSrc(data.item.achievement.icon)"
                  [alt]="data.item.achievement.name"
                />
              } @else {
                <mat-icon>{{ data.item.achievement.icon }}</mat-icon>
              }
            </div>
            <div class="splash-label">Achievement Unlocked</div>
            <h2 class="splash-name">{{ data.item.achievement.name }}</h2>
            <p class="splash-desc">{{ data.item.achievement.description }}</p>
            @if (data.item.achievement.points > 0) {
              <div class="splash-points">+{{ data.item.achievement.points }} {{ brand.points() }}</div>
            }
            @if (data.item.achievement.title) {
              <div class="splash-title-hint">
                New title unlocked: "{{ data.item.achievement.title }}"
              </div>
            }
          }
          @case ('release') {
            <div class="splash-icon"><mat-icon>rocket_launch</mat-icon></div>
            <div class="splash-label">What's New — v{{ data.item.release.version }}</div>
            <h2 class="splash-name">{{ terms(data.item.release.title) }}</h2>
            <div class="splash-body" [innerHTML]="safeHtml(terms(data.item.release.body))"></div>
          }
          @case ('announcement') {
            <div class="splash-icon"><mat-icon>campaign</mat-icon></div>
            <div class="splash-label">Announcement</div>
            <h2 class="splash-name">{{ data.item.announcement.title }}</h2>
            <div class="splash-body" [innerHTML]="safeHtml(data.item.announcement.body)"></div>
          }
        }

        <button mat-raised-button color="primary" (click)="close()">
          {{ data.remaining > 1 ? 'Next' : 'Nice!' }}
        </button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .splash {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 300px;
        max-width: 420px;
        padding: 8px;
        overflow: hidden;
      }
      .splash.patriotic {
        /* Explicit size (not just extra padding) so the fireworks sky is a real
         2-3x-larger frame around the card, not capped by the compact
         max-width above — the card stays its normal size and floats in
         the middle via flex centering. */
        width: min(92vw, 820px);
        height: min(80vh, 680px);
        max-width: none;
        padding: 16px;
      }
      .splash-card {
        position: relative;
        z-index: 2;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 8px;
        max-width: 340px;
        max-height: 80vh;
        overflow-y: auto;
        padding: 24px 20px 20px;
        background: #fffaf3;
        border-radius: 16px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
      }
      .splash-icon {
        width: 84px;
        height: 84px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle, #fff7e6 0%, #f5e3bf 100%);
        box-shadow: 0 4px 18px rgba(201, 147, 58, 0.45);
        margin-bottom: 6px;
        flex-shrink: 0;
        mat-icon {
          font-size: 44px;
          width: 44px;
          height: 44px;
          color: var(--db-primary);
        }
        img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        }
      }
      .splash-counter {
        align-self: flex-end;
        font-size: 0.72rem;
        font-weight: 600;
        color: #999;
        background: #f0ebe4;
        padding: 2px 10px;
        border-radius: 999px;
        margin-bottom: -4px;
      }
      .splash-label {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--db-primary);
      }
      .splash-name {
        margin: 0;
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--db-primary);
      }
      .splash-desc {
        margin: 0;
        font-size: 0.9rem;
        color: #666;
        line-height: 1.4;
      }
      .splash-body {
        margin: 0;
        font-size: 0.9rem;
        color: #555;
        line-height: 1.6;
        text-align: left;
        width: 100%;
      }
      .splash-points {
        font-size: 0.95rem;
        font-weight: 700;
        color: #2e7d32;
        background: #eaf6ea;
        padding: 4px 12px;
        border-radius: 999px;
      }
      .splash-title-hint {
        font-size: 0.8rem;
        color: var(--db-primary);
        font-weight: 600;
      }
      button {
        margin-top: 10px;
        flex-shrink: 0;
      }

      .fireworks {
        position: absolute;
        inset: 0;
        z-index: 1;
        overflow: hidden;
        pointer-events: none;
        background: linear-gradient(180deg, #0b1d3a 0%, #14274d 100%);
      }
      .burst {
        position: absolute;
        width: 0;
        height: 0;
        opacity: 0;
        animation: burst-appear 900ms ease-out forwards;
      }
      .particle {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        left: 0;
        top: 0;
        box-shadow: 0 0 8px 2px currentColor;
        transform: rotate(var(--angle, 0deg)) translateX(0);
        animation: particle-fly 900ms ease-out forwards;
      }
      @keyframes burst-appear {
        0% {
          opacity: 0;
        }
        1% {
          opacity: 1;
        }
        80% {
          opacity: 1;
        }
        100% {
          opacity: 0;
        }
      }
      @keyframes particle-fly {
        0% {
          transform: rotate(var(--angle, 0deg)) translateX(0);
          opacity: 1;
        }
        100% {
          transform: rotate(var(--angle, 0deg)) translateX(var(--dist, 60px));
          opacity: 0;
        }
      }
    `,
  ],
})
export class SplashComponent implements OnDestroy {
  readonly data = inject<SplashDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SplashComponent>);
  private readonly sanitizer = inject(DomSanitizer);
  readonly brand = inject(BrandConfigService);

  readonly isPatriotic =
    this.data.item.kind === 'achievement' && this.data.item.achievement.key === 'patriotic_bear';
  readonly bursts = signal<Burst[]>([]);

  private nextBurstId = 0;
  private burstInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (this.isPatriotic) {
      // Fire a few right away so it doesn't look sparse the instant the dialog opens.
      this.spawnBurst();
      this.spawnBurst();
      this.spawnBurst();
      this.burstInterval = setInterval(() => this.spawnBurst(), BURST_INTERVAL_MS);
    }
  }

  ngOnDestroy(): void {
    if (this.burstInterval) clearInterval(this.burstInterval);
  }

  private spawnBurst(): void {
    this.bursts.update((b) => [...b, buildBurst(this.nextBurstId++)].slice(-MAX_VISIBLE_BURSTS));
  }

  close(): void {
    this.dialogRef.close();
  }

  isImgIcon(icon: string): boolean {
    return icon.startsWith('img:');
  }

  imgIconSrc(icon: string): string {
    return icon.slice(4);
  }

  safeHtml(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(content));
  }

  // Release notes carry {{events}}-style placeholders; announcements don't.
  terms(content: string): string {
    return substituteTerms(content, this.brand);
  }
}
