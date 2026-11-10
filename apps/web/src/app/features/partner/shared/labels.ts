import { DocumentRejectionReason, DocumentType, PartnerType, TripType } from '@payana/contracts';
import type { IconName } from '@ui/icon';

/** Wording used across the partner screens, kept in one place so it stays consistent. */

export const TRIP_TYPE: Record<TripType, { label: string; icon: IconName }> = {
  [TripType.Immediate]: { label: 'Ride now', icon: 'clock' },
  [TripType.Scheduled]: { label: 'Booked ahead', icon: 'calendar' },
  [TripType.Outstation]: { label: 'Outstation', icon: 'route' },
  [TripType.Sightseeing]: { label: 'Sightseeing', icon: 'compass' },
};

export const PARTNER_TYPE: Record<PartnerType, { label: string; help: string; icon: IconName }> = {
  [PartnerType.OwnerDriver]: {
    label: 'I drive my own vehicle',
    help: 'The vehicle is registered in your name and you are the one driving it.',
    icon: 'car',
  },
  [PartnerType.FleetOwner]: {
    label: 'I own vehicles others drive',
    help: 'You list one or more vehicles and authorise drivers to operate them.',
    icon: 'users',
  },
  [PartnerType.HiredDriver]: {
    label: 'I drive someone else’s vehicle',
    help: 'The owner lists the vehicle and authorises you to drive it.',
    icon: 'key',
  },
};

export const DOCUMENT: Record<DocumentType, { label: string; help: string; numberLabel: string }> = {
  [DocumentType.Identity]: {
    label: 'Photo identity',
    help: 'Aadhaar, voter ID, passport or PAN card — a clear photo or scan.',
    numberLabel: 'ID number',
  },
  [DocumentType.DrivingLicence]: {
    label: 'Driving licence',
    help: 'Both sides, valid for the class of vehicle you drive.',
    numberLabel: 'Licence number',
  },
  [DocumentType.VehicleRegistration]: {
    label: 'Registration certificate (RC)',
    help: 'The RC book or smart card showing the registration number and owner.',
    numberLabel: 'Registration number',
  },
  [DocumentType.Insurance]: {
    label: 'Insurance policy',
    help: 'The current policy schedule showing the vehicle number and dates.',
    numberLabel: 'Policy number',
  },
  [DocumentType.Permit]: {
    label: 'Transport permit',
    help: 'The permit that allows this vehicle to carry passengers for hire.',
    numberLabel: 'Permit number',
  },
  [DocumentType.Fitness]: {
    label: 'Fitness certificate',
    help: 'The certificate of fitness issued by the RTO.',
    numberLabel: 'Certificate number',
  },
  [DocumentType.PollutionCertificate]: {
    label: 'Pollution certificate (PUC)',
    help: 'Optional, but customers trust a vehicle with a current PUC.',
    numberLabel: 'Certificate number',
  },
  [DocumentType.OwnerAuthorisation]: {
    label: 'Owner’s authorisation letter',
    help: 'A signed letter from the registered owner allowing you to drive their vehicle.',
    numberLabel: 'Reference',
  },
};

export const REJECTION_REASON: Record<DocumentRejectionReason, string> = {
  [DocumentRejectionReason.Unreadable]: 'The photo or scan could not be read. Retake it in good light, with all four corners visible.',
  [DocumentRejectionReason.Expired]: 'The document has expired. Upload the renewed one.',
  [DocumentRejectionReason.NameMismatch]: 'The name on the document does not match your profile.',
  [DocumentRejectionReason.NumberMismatch]: 'The number on the document does not match what was entered.',
  [DocumentRejectionReason.WrongDocument]: 'This is not the document that was asked for.',
  [DocumentRejectionReason.SuspectedForgery]: 'The document could not be accepted as genuine. Contact support.',
  [DocumentRejectionReason.Other]: 'The document was not accepted. See the reviewer’s note.',
};

export const LANGUAGE_CHOICES = ['Kannada', 'Konkani', 'Hindi', 'English', 'Marathi', 'Malayalam', 'Tamil', 'Telugu'] as const;

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
