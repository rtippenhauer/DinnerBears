import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { MemberPointEntity, PointType } from '../../database/entities/member-point.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
import { UserRole } from '../../database/entities/user.entity';
import { AchievementEntity } from '../../database/entities/achievement.entity';
import { AchievementsService } from './achievements.service';

export type SecretDinnerResync = { enabled: true; awarded: number } | { enabled: false; removed: number };

export interface PointSummary {
  total: number;
  byType: Record<PointType, number>;
}

export interface PointLedgerEntry {
  date: Date;
  achievement: string;
  points: number;
}

export interface PointLedgerDetailed {
  entries: PointLedgerEntry[];
  total: number;
}

const POINT_TYPE_LABELS: Record<Exclude<PointType, PointType.ACHIEVEMENT>, string> = {
  [PointType.ATTENDANCE]: 'Attended a dinner',
  [PointType.COORDINATOR]: 'Coordinated a dinner',
  [PointType.NEW_LOCATION_COORDINATOR]: 'Coordinated a dinner at a new restaurant',
  [PointType.INVITE]: 'Invited a member who attended their first dinner',
  [PointType.RATING]: 'Rated a restaurant',
  [PointType.CITY_HOPPER]: 'Dined in a new city',
  [PointType.SECRET_DINNER]: 'Attended a secret dinner',
};

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  fullName: string;
  profilePhotoPath: string | null;
  selectedTitle: string | null;
  totalPoints: number;
  topType: PointType | null;
  cityId: number;
  cityName: string;
  isNew: boolean;
}

@Injectable()
export class PointsService {
  constructor(
    @InjectRepository(MemberPointEntity)
    private readonly pointRepo: Repository<MemberPointEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
    @InjectRepository(EventRsvpEntity)
    private readonly rsvpRepo: Repository<EventRsvpEntity>,
    private readonly achievementsService: AchievementsService,
    private readonly dataSource: DataSource,
  ) {}

  async awardAttendance(userId: number, eventId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: { userId, pointType: PointType.ATTENDANCE, referenceId: eventId },
    });
    if (exists) return;

    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType: PointType.ATTENDANCE, referenceId: eventId, points: 1 }),
    );

    await this.achievementsService.checkAttendanceAchievements(userId);
    await this.checkInvitePointForInviter(userId);
  }

  async awardCoordinator(userId: number, eventId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: [
        { userId, pointType: PointType.COORDINATOR, referenceId: eventId },
        { userId, pointType: PointType.NEW_LOCATION_COORDINATOR, referenceId: eventId },
      ],
    });
    if (exists) return;

    const event = await this.eventRepo.findOne({ where: { id: eventId }, relations: ['location'] });
    if (!event) return;

    // Scout credit: location was added to DinnerBears within the last week —
    // meaning the coordinator suggested this new place and added it themselves.
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const locationAge = event.location?.createdAt
      ? Date.now() - new Date(event.location.createdAt).getTime()
      : Infinity;
    const isNewLocation = locationAge < ONE_WEEK_MS;
    const pointType = isNewLocation ? PointType.NEW_LOCATION_COORDINATOR : PointType.COORDINATOR;
    const points = isNewLocation ? 4 : 2;

    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType, referenceId: eventId, points }),
    );

    await this.achievementsService.checkCoordinatorAchievements(userId);
  }

  async awardRating(userId: number, locationId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: { userId, pointType: PointType.RATING, referenceId: locationId },
    });
    if (exists) return;

    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType: PointType.RATING, referenceId: locationId, points: 1 }),
    );

    await this.achievementsService.checkRatingAchievements(userId);
  }

  private async checkInvitePointForInviter(attendeeId: number): Promise<void> {
    // Only fire on first attended dinner
    const priorAttended = await this.pointRepo.count({
      where: { userId: attendeeId, pointType: PointType.ATTENDANCE },
    });
    if (priorAttended !== 1) return; // not their first

    // Walk invite lineage to find inviter
    const attendee = await this.dataSource
      .getRepository('users')
      .createQueryBuilder('u')
      .select(['u.id AS id', 'u.invited_by AS invitedBy'])
      .where('u.id = :id', { id: attendeeId })
      .getRawOne<{ id: number; invitedBy: number | null }>();

    const inviterId = attendee?.invitedBy ?? null;
    if (!inviterId) return;

    const alreadyAwarded = await this.pointRepo.findOne({
      where: { userId: inviterId, pointType: PointType.INVITE, referenceId: attendeeId },
    });
    if (alreadyAwarded) return;

    await this.pointRepo.save(
      this.pointRepo.create({ userId: inviterId, pointType: PointType.INVITE, referenceId: attendeeId, points: 1 }),
    );

    await this.achievementsService.checkInviteAchievements(inviterId);
  }

  async getSummary(userId: number): Promise<PointSummary> {
    const rows = await this.pointRepo
      .createQueryBuilder('mp')
      .select('mp.point_type', 'type')
      .addSelect('SUM(mp.points)', 'total')
      .where('mp.user_id = :uid', { uid: userId })
      .groupBy('mp.point_type')
      .getRawMany<{ type: PointType; total: string }>();

    const byType = {} as Record<PointType, number>;
    let grandTotal = 0;
    for (const r of rows) {
      byType[r.type] = Number(r.total);
      grandTotal += Number(r.total);
    }
    return { total: grandTotal, byType };
  }

  async getLeaderboard(cityId?: number): Promise<LeaderboardEntry[]> {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const qb = this.dataSource
      .createQueryBuilder()
      .select('u.id', 'userId')
      .addSelect('u.full_name', 'fullName')
      .addSelect('u.profile_photo_path', 'profilePhotoPath')
      .addSelect('u.selected_title', 'selectedTitle')
      .addSelect('u.city_id', 'cityId')
      .addSelect('c.name', 'cityName')
      .addSelect('COALESCE(SUM(mp.points), 0)', 'totalPoints')
      .addSelect(`IF(u.created_at >= :twa, 1, 0)`, 'isNew')
      .from('users', 'u')
      .leftJoin('cities', 'c', 'c.id = u.city_id')
      .leftJoin('member_points', 'mp', 'mp.user_id = u.id')
      .where('u.status = :status', { status: 'active' })
      .andWhere('u.role NOT IN (:...excludedRoles)', { excludedRoles: ['admin', UserRole.AUTOMATION, UserRole.MUSE] })
      .setParameter('twa', twoWeeksAgo)
      .groupBy('u.id')
      .orderBy('totalPoints', 'DESC')
      .addOrderBy('u.full_name', 'ASC');

    if (cityId) {
      qb.andWhere('u.city_id = :cityId', { cityId });
    }

    const rows = await qb.getRawMany<{
      userId: number;
      fullName: string;
      profilePhotoPath: string | null;
      selectedTitle: string | null;
      cityId: number;
      cityName: string;
      totalPoints: string;
      isNew: number;
    }>();

    // Determine top point type per user
    const userIds = rows.map((r) => r.userId);
    const topTypeMap: Record<number, PointType | null> = {};
    if (userIds.length > 0) {
      const topRows = await this.dataSource
        .createQueryBuilder()
        .select('mp.user_id', 'userId')
        .addSelect('mp.point_type', 'pointType')
        .addSelect('SUM(mp.points)', 'pts')
        .from('member_points', 'mp')
        .where('mp.user_id IN (:...ids)', { ids: userIds })
        .groupBy('mp.user_id, mp.point_type')
        .orderBy('pts', 'DESC')
        .getRawMany<{ userId: number; pointType: PointType; pts: string }>();

      for (const tr of topRows) {
        if (!topTypeMap[tr.userId]) topTypeMap[tr.userId] = tr.pointType;
      }
    }

    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      fullName: r.fullName,
      profilePhotoPath: r.profilePhotoPath,
      selectedTitle: r.selectedTitle,
      totalPoints: Number(r.totalPoints),
      topType: topTypeMap[r.userId] ?? null,
      cityId: r.cityId,
      cityName: r.cityName,
      isNew: Boolean(r.isNew),
    }));
  }

  async getLedger(userId: number): Promise<MemberPointEntity[]> {
    return this.pointRepo.find({
      where: { userId },
      order: { awardedAt: 'DESC' },
    });
  }

  async getLedgerDetailed(userId: number): Promise<PointLedgerDetailed> {
    const rows = await this.getLedger(userId);

    const achievementIds = [
      ...new Set(rows.filter((r) => r.pointType === PointType.ACHIEVEMENT).map((r) => r.referenceId)),
    ];
    const achievementNames = new Map<number, string>();
    if (achievementIds.length > 0) {
      const achievements = await this.dataSource
        .getRepository(AchievementEntity)
        .findBy({ id: In(achievementIds) });
      for (const a of achievements) achievementNames.set(a.id, a.name);
    }

    const entries: PointLedgerEntry[] = rows.map((r) => ({
      date: r.awardedAt,
      achievement:
        r.pointType === PointType.ACHIEVEMENT
          ? achievementNames.get(r.referenceId) ?? 'Achievement unlocked'
          : POINT_TYPE_LABELS[r.pointType],
      points: r.points,
    }));

    return { entries, total: rows.reduce((sum, r) => sum + r.points, 0) };
  }

  async adminAwardPoints(userId: number, pointType: PointType, points: number, referenceId: number): Promise<void> {
    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType, points, referenceId }),
    );
  }

  async adminRemovePoints(pointId: number): Promise<void> {
    await this.pointRepo.delete(pointId);
  }

  async awardCityHopper(userId: number, eventId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: { userId, pointType: PointType.CITY_HOPPER, referenceId: eventId },
    });
    if (exists) return;
    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType: PointType.CITY_HOPPER, referenceId: eventId, points: 1 }),
    );
    await this.achievementsService.checkCityHopperAchievements(userId);
  }

  async awardSecretDinner(userId: number, eventId: number): Promise<void> {
    const exists = await this.pointRepo.findOne({
      where: { userId, pointType: PointType.SECRET_DINNER, referenceId: eventId },
    });
    if (exists) return;
    await this.pointRepo.save(
      this.pointRepo.create({ userId, pointType: PointType.SECRET_DINNER, referenceId: eventId, points: 1 }),
    );
    await this.achievementsService.checkSecretDinnerAchievements(userId);
  }

  // Called whenever an admin flips an event's is_secret flag, so already-attended
  // members aren't stuck with (or stripped of) secret-dinner credit just because
  // of when the flag happened to change relative to their attendance being marked.
  // Scoped to this one event's attendees, so cost stays flat regardless of how
  // many events exist overall.
  async resyncSecretDinnerForEvent(eventId: number, isSecret: boolean): Promise<SecretDinnerResync> {
    if (isSecret) {
      const attendees = await this.rsvpRepo.find({
        where: { eventId, attended: true },
        select: ['userId'],
      });
      for (const { userId } of attendees) {
        await this.awardSecretDinner(userId, eventId);
      }
      return { enabled: true, awarded: attendees.length };
    }

    const rows = await this.pointRepo.find({
      where: { pointType: PointType.SECRET_DINNER, referenceId: eventId },
    });
    if (rows.length === 0) return { enabled: false, removed: 0 };
    await this.pointRepo.delete({ pointType: PointType.SECRET_DINNER, referenceId: eventId });
    for (const { userId } of rows) {
      await this.achievementsService.recheckSecretDinnerAchievements(userId);
    }
    return { enabled: false, removed: rows.length };
  }
}
