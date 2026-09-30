import { Component, inject, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './core/services/auth.service';
import { BrandConfigService } from './core/services/brand-config.service';
import { CityService } from './core/services/city.service';
import { FeedbackService } from './core/services/feedback.service';
import { HealthService } from './core/services/health.service';
import { MerchService } from './core/services/merch.service';
import { SplashService } from './core/services/splash.service';
import { NotificationBellComponent } from './shared/components/notification-bell/notification-bell.component';
import { IosInstallBannerComponent } from './shared/components/ios-install-banner/ios-install-banner.component';
import { SplashComponent, SplashDialogData } from './shared/components/splash/splash.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatMenuModule,
    MatDividerModule,
    NotificationBellComponent,
    IosInstallBannerComponent,
  ],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly breakpointObserver = inject(BreakpointObserver);
  readonly authService = inject(AuthService);
  readonly brandConfig = inject(BrandConfigService);
  private readonly cityService = inject(CityService);
  readonly feedbackService = inject(FeedbackService);
  private readonly merchService = inject(MerchService);
  private readonly splashService = inject(SplashService);
  readonly healthService = inject(HealthService);
  private readonly dialog = inject(MatDialog);
  private splashDialogOpen = false;

  readonly currentYear = new Date().getFullYear();
  get isStage(): boolean {
    return this.brandConfig.isStage();
  }

  private readonly router = inject(Router);

  isMobile = toSignal(
    this.breakpointObserver
      .observe([Breakpoints.XSmall, Breakpoints.Small])
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly isEventsMenuActive = computed(() => {
    const url = this.currentUrl();
    return url.startsWith('/events') || url.startsWith('/calendar') || url.startsWith('/ratings');
  });

  readonly isCommunityMenuActive = computed(() => {
    const url = this.currentUrl();
    return (
      url.startsWith('/locations') ||
      url.startsWith('/merch') ||
      url.startsWith('/members') ||
      url.startsWith('/invite')
    );
  });

  readonly isUpdatesMenuActive = computed(() => {
    const url = this.currentUrl();
    return (
      url.startsWith('/announcements') || url.startsWith('/feedback') || url.startsWith('/updates')
    );
  });

  readonly isSecurityMenuActive = computed(() => {
    const url = this.currentUrl();
    return (
      url.startsWith('/admin/users') ||
      url.startsWith('/admin/invites') ||
      url.startsWith('/admin/facebook-accounts') ||
      url.startsWith('/admin/audit')
    );
  });

  readonly isSettingsMenuActive = computed(() => {
    const url = this.currentUrl();
    return (
      url.startsWith('/admin/email') ||
      url.startsWith('/admin/cities') ||
      url.startsWith('/admin/integrations') ||
      url.startsWith('/admin/merch') ||
      url.startsWith('/admin/legal')
    );
  });

  readonly isAdminMembersMenuActive = computed(() => {
    const url = this.currentUrl();
    return (
      url.startsWith('/admin/feedback') ||
      url.startsWith('/admin/achievements') ||
      url.startsWith('/admin/icons') ||
      url.startsWith('/admin/announcements') ||
      url.startsWith('/admin/moderation')
    );
  });

  readonly isReleasesMenuActive = computed(() => {
    const url = this.currentUrl();
    return url.startsWith('/admin/releases');
  });

  readonly isAdminMenuActive = computed(
    () =>
      this.isSecurityMenuActive() ||
      this.isSettingsMenuActive() ||
      this.isAdminMembersMenuActive() ||
      this.isReleasesMenuActive(),
  );

  readonly userInitials = computed<string>(() => {
    const name = this.authService.currentUser()?.fullName ?? '';
    return name
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  });

  readonly userPhoto = computed<string | null>(
    () => this.authService.currentUser()?.profilePhotoPath ?? null,
  );

  readonly isAdmin = computed<boolean>(() => this.authService.currentUser()?.role === 'admin');

  readonly isModerator = computed<boolean>(
    () => this.authService.currentUser()?.role === 'moderator',
  );

  readonly isNonValidated = computed<boolean>(
    () => this.authService.currentUser()?.role === 'non_validated',
  );

  readonly isMerchOpen = computed<boolean>(() => {
    const links = this.merchService.links();
    return !!(links?.storeUrl || links?.foundingBearProductUrl);
  });

  constructor() {
    this.healthService.load();

    // Safety net for unrecognized hosts (typo'd DNS entry, a decommissioned
    // city, someone hitting the wildcard cert directly): city-scoped features
    // like Facebook login assume the current hostname is either a known
    // chapter subdomain or the instance's own canonical root. The canonical
    // root now comes from the runtime branding config (APP_URL) rather than a
    // compiled-in constant, so one image can serve any instance. Skipped in
    // local dev, where the hostname is never one of those anyway.
    effect(() => {
      if (!environment.production) return;
      if (this.cityService.cities().length === 0) return; // wait for the list to load

      const appUrl = this.brandConfig.appUrl();
      if (!appUrl) return; // no canonical URL configured — nothing to redirect to

      const hostname = window.location.hostname.toLowerCase();
      const rootHostname = new URL(appUrl).hostname.toLowerCase();
      const isKnownHost = hostname === rootHostname || this.cityService.currentCity() !== undefined;

      if (!isKnownHost) {
        window.location.href = appUrl;
      }
    });

    effect(() => {
      if (this.isAdmin()) {
        this.feedbackService.loadUnseenCount();
      } else {
        this.feedbackService.unseenCount.set(0);
      }
    });

    effect(() => {
      if (this.authService.currentUser()) {
        this.splashService.startPolling();
      } else {
        this.splashService.stopPolling();
      }
    });

    effect(() => {
      if (this.authService.currentUser()) {
        this.merchService.loadLinks();
      } else {
        this.merchService.links.set(null);
      }
    });

    effect(() => {
      const queue = this.splashService.queue();
      const next = queue[0];
      if (next && !this.splashDialogOpen) {
        this.splashDialogOpen = true;
        const data: SplashDialogData = { item: next, remaining: queue.length };
        this.dialog
          .open(SplashComponent, {
            data,
            panelClass: 'splash-panel',
            disableClose: true,
            // Material defaults dialogs to maxWidth: 80vw, which fights with
            // the patriotic splash's own (larger) intrinsic sizing — let the
            // component's own CSS be the only thing constraining its size.
            maxWidth: 'none',
            // Default autoFocus ('first-tabbable') focuses the "Nice!"/"Next"
            // button at the bottom of the card, which scrolls the scrollable
            // .splash-card container down to reveal it — landing on the
            // bottom of a long release note instead of the top. The heading
            // is near the top in every splash kind and keeps scroll position
            // sane (and reads better for screen readers than "button").
            autoFocus: 'first-heading',
          })
          .afterClosed()
          .subscribe(() => {
            this.splashService.dismiss(next);
            this.splashDialogOpen = false;
          });
      }
    });

    const swUpdate = inject(SwUpdate);
    if (swUpdate.isEnabled) {
      swUpdate.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() => {
          swUpdate.activateUpdate().then(() => document.location.reload());
        });
      swUpdate.checkForUpdate();
    }
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  logout(): void {
    this.authService.logout();
  }
}
