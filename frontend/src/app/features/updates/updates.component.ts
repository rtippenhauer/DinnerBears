import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ReleasesService, Release } from '../../core/services/releases.service';
import { AuthService } from '../../core/services/auth.service';
import { BrandConfigService } from '../../core/services/brand-config.service';
import { normalizeNbsp } from '../../shared/utils/normalize-nbsp';
import { substituteTerms } from '../../shared/utils/substitute-terms';

@Component({
  selector: 'app-updates',
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="updates-page">
      <div class="page-header">
        <div>
          <h1>Release Notes</h1>
          <p class="subtitle">What's new.</p>
        </div>
        @if (!isNonValidated()) {
          <button mat-stroked-button routerLink="/feedback">
            <mat-icon>feedback</mat-icon> Give Feedback
          </button>
        }
      </div>

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else if (releases().length === 0) {
        <div class="empty-state">
          <mat-icon>rocket_launch</mat-icon>
          <p>No releases yet — check back soon.</p>
        </div>
      } @else {
        <div class="releases-list">
          @for (release of releases(); track release.id) {
            <article class="release-card">
              <div class="release-version-row">
                <span class="version-badge">{{ versionLabel(release) }}</span>
                <span class="release-date">{{ release.publishedAt | date: 'MMMM d, y' }}</span>
              </div>
              <h2 class="release-title">{{ terms(release.title) }}</h2>
              <div class="release-body" [innerHTML]="safeHtml(release.body)"></div>

              @if (creditedItems(release).length > 0) {
                <div class="community-credit">
                  <mat-icon class="credit-icon">people</mat-icon>
                  <span>
                    Thanks to {{ creditList(release) }} for the feedback that made this possible.
                  </span>
                </div>
              }
            </article>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .updates-page {
        max-width: 760px;
        margin: 0 auto;
        padding: 24px 16px;
      }

      .page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 32px;
        h1 {
          margin: 0 0 4px;
          font-size: 1.75rem;
          color: var(--db-brown-dark);
        }
      }
      .subtitle {
        margin: 0;
        font-size: 0.9rem;
        color: #666;
      }

      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty-state {
        text-align: center;
        padding: 48px 0;
        mat-icon {
          font-size: 3rem;
          width: 3rem;
          height: 3rem;
          color: #ccc;
          margin-bottom: 12px;
        }
        p {
          color: #999;
          margin: 0;
        }
      }

      .releases-list {
        display: flex;
        flex-direction: column;
        gap: 32px;
      }

      .release-card {
        background: white;
        border-radius: 12px;
        padding: 28px;
        box-shadow: 0 2px 8px rgba(61, 28, 5, 0.07);
        border-left: 4px solid var(--db-primary);
        overflow-wrap: break-word;
        min-width: 0;
      }

      .release-version-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
      }
      .version-badge {
        font-size: 0.78rem;
        font-weight: 800;
        padding: 3px 10px;
        border-radius: 12px;
        background: var(--db-primary);
        color: white;
        letter-spacing: 0.05em;
      }
      .release-date {
        font-size: 0.82rem;
        color: #aaa;
      }

      .release-title {
        margin: 0 0 16px;
        font-size: 1.25rem;
        color: var(--db-brown-dark);
      }

      .release-body {
        font-size: 0.95rem;
        line-height: 1.7;
        color: #333;
        overflow-wrap: break-word;
        word-break: normal;
        hyphens: none;
        min-width: 0;
        ::ng-deep p {
          margin: 0 0 10px;
          &:last-child {
            margin-bottom: 0;
          }
        }
        ::ng-deep ul,
        ::ng-deep ol {
          padding-left: 20px;
          margin: 0 0 10px;
        }
        ::ng-deep h2,
        ::ng-deep h3 {
          margin: 16px 0 8px;
          color: var(--db-brown-dark);
        }
      }

      .community-credit {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 16px;
        padding: 10px 14px;
        background: #f3f8ff;
        border-radius: 8px;
        font-size: 0.85rem;
        color: #555;
        .credit-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
          color: var(--db-primary);
          flex-shrink: 0;
          margin-top: 1px;
        }
      }
    `,
  ],
})
export class UpdatesComponent implements OnInit {
  private readonly releasesService = inject(ReleasesService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly authService = inject(AuthService);
  private readonly brandConfig = inject(BrandConfigService);

  isNonValidated(): boolean {
    return this.authService.isNonValidated();
  }

  readonly loading = signal(true);
  readonly releases = signal<Release[]>([]);

  ngOnInit(): void {
    this.releasesService.getPublished().subscribe({
      next: (data) => {
        this.releases.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  safeHtml(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(this.terms(content)));
  }

  terms(content: string): string {
    return substituteTerms(content, this.brandConfig);
  }

  versionLabel(release: Release): string {
    return /^\d/.test(release.version) ? `v${release.version}` : release.version;
  }

  creditedItems(release: Release): Release['linkedFeedback'] {
    return release.linkedFeedback ?? [];
  }

  creditList(release: Release): string {
    const names = (release.linkedFeedback ?? []).map((fb) =>
      fb.isPrivate ? 'a community member' : (fb.user?.fullName ?? 'a community member'),
    );
    const unique = [...new Set(names)];
    if (unique.length === 1) return unique[0];
    if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
    return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
  }
}
