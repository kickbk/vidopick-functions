import * as admin from 'firebase-admin';
// Initialize Firebase Admin
admin.initializeApp();

export { attribute } from './functions/attribute';
export { compressUploadedImage } from './functions/compressUploadedImage';
export { createOrganizationAccount } from './functions/createOrganizationAccount';
export { deleteOrganization } from './functions/deleteOrganization';
export { removeOrganizationAccount } from './functions/removeOrganizationAccount';
export { sendOrganizationInvite, sendSignInLink } from './functions/sendOrganizationMagicLink';
export { sendAppMagicLink } from './functions/sendAppMagicLink';
export { revokeProAccount } from './functions/revokeProAccount';
export { getCustomTokenForCheckout } from './functions/getCustomTokenForCheckout';
export { createStripeCheckoutSession } from './functions/createStripeCheckoutSession';
export { stripeWebhook } from './functions/stripeWebhook';
export {
  createDeviceSession,
  confirmDeviceSession,
  sendDeviceAuthLink,
} from './functions/createDeviceSession';
export { sendDemoInvite } from './functions/sendDemoInvite';
export { acquireDemoSession } from './functions/acquireDemoSession';
export { releaseDemoSession } from './functions/releaseDemoSession';
export { demoHeartbeat } from './functions/demoHeartbeat';
export { scheduledDemoSessionCheck } from './functions/scheduledDemoSessionCheck';
export { createShortLink } from './functions/createShortLink';
export { getNextAdBatch } from './functions/getNextAdBatch';
export { handleDeeplink } from './functions/handleDeeplink';
export {
  createInvite,
  deleteInvite,
  disableInvite,
  listInvites,
  updateInvite,
} from './functions/inviteManagement';
export { savePlaylistFromExtension } from './functions/savePlaylistFromExtension';
export { deletePlaylistFromExtension } from './functions/deletePlaylistFromExtension';
export { sendSupportEmail } from './functions/sendSupportEmail';
export { sendSamEmail } from './functions/sendSamEmail';
export { setAdminClaims } from './functions/setAdminClaims';
export {
  setOrganizationClaims,
  setOrganizationClaimsManual,
} from './functions/setOrganizationClaims';
export { setMemberClaims } from './functions/setMemberClaims';
export { completeMemberAppSignIn } from './functions/completeMemberAppSignIn';
export { updateDisplayName } from './functions/updateDisplayName';
export { sendMemberAppInvite } from './functions/sendMemberAppInvite';
export { cancelStripeSubscription } from './functions/cancelStripeSubscription';
export { monthlyOrgBilling } from './functions/monthlyOrgBilling';
export { createOrgStripeCheckout } from './functions/createOrgStripeCheckout';
export { createOrgStripePortalSession } from './functions/createOrgStripePortalSession';
export { cancelOrgSubscription } from './functions/cancelOrgSubscription';
export { listOrgInvoices } from './functions/listOrgInvoices';
export { createStripePortalSession } from './functions/createStripePortalSession';
export { sendAnnouncement } from './functions/sendAnnouncement';
export { markNotificationsViewed } from './functions/markNotificationsViewed';
export { migrateProfilesToSubcollection } from './functions/migrateProfilesToSubcollection';
export {
  requestOrgSponsorship,
  approveSponsorshipRequest,
  declineSponsorshipRequest,
  revokeOrgSponsorship,
  requestProfileFollow,
  approveProfileFollow,
  declineProfileFollow,
  removeProfileFollower,
  unfollowProfile,
  revokeProfileFollower,
  listProfileFollowers,
  removeProfileFollowerDirect,
  onProfileChanged,
} from './functions/profileFollowManagement';
export { trackAdImpression } from './functions/trackAdImpression';
export { refreshPlaylistMetadata } from './functions/refreshPlaylistMetadata';
export { analyzeSharedPlaylist } from './functions/analyzeSharedPlaylist';
export { scanUserPlaylist } from './functions/scanUserPlaylist';
export {
  onPlaylistCreated,
  onPlaylistDeleted,
  backfillPlaylistIdIndex,
  getPlaylistIdIndex,
} from './functions/syncPlaylistIdIndex';
export { onUserCreated } from './functions/onUserCreated';
