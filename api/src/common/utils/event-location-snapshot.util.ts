import { Repository } from 'typeorm';
import { EventEntity, EventStatus } from '../../database/entities/event.entity';
import { LocationEntity } from '../../database/entities/location.entity';

// The Eastern calendar date, "YYYY-MM-DD" — the same notion of "today" the
// RSVP rules use.
export function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

type LocationDetails = Pick<LocationEntity, 'id' | 'name' | 'address' | 'lat' | 'lng'>;

// Events keep their own copy of the location's name, address and coordinates,
// so a past dinner still shows where it actually was after the place is
// renamed or moves. Upcoming (and today's) events should follow the location,
// though — otherwise fixing a location's name leaves the old one on every
// dinner already scheduled there. Cancelled and past events are left alone.
export async function refreshUpcomingEventLocations(
  eventRepo: Repository<EventEntity>,
  location: LocationDetails,
): Promise<number> {
  const result = await eventRepo
    .createQueryBuilder()
    .update(EventEntity)
    .set({
      locationName: location.name,
      locationAddress: location.address,
      locationLat: location.lat,
      locationLng: location.lng,
    })
    .where('location_id = :id', { id: location.id })
    .andWhere('event_date >= :today', { today: easternToday() })
    .andWhere('status != :cancelled', { cancelled: EventStatus.CANCELLED })
    .execute();
  return result.affected ?? 0;
}
