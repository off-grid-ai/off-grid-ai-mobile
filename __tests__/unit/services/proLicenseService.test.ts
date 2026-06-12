import {
  readProFromKeychain,
  checkProStatus,
} from '../../../src/services/proLicenseService';

jest.mock('react-native-purchases', () => ({
  default: { setLogLevel: jest.fn(), configure: jest.fn(), getCustomerInfo: jest.fn() },
  LOG_LEVEL: { DEBUG: 'debug', ERROR: 'error' },
}), { virtual: true });

jest.mock('react-native-purchases-ui', () => ({
  default: { presentPaywall: jest.fn() },
  PAYWALL_RESULT: { PURCHASED: 'PURCHASED', RESTORED: 'RESTORED', NOT_PRESENTED: 'NOT_PRESENTED', ERROR: 'ERROR', CANCELLED: 'CANCELLED' },
}), { virtual: true });

const mockGetGenericPassword = jest.fn();
const mockSetGenericPassword = jest.fn();
const mockResetGenericPassword = jest.fn();

jest.mock('react-native-keychain', () => ({
  getGenericPassword: (...args: any[]) => mockGetGenericPassword(...args),
  setGenericPassword: (...args: any[]) => mockSetGenericPassword(...args),
  resetGenericPassword: (...args: any[]) => mockResetGenericPassword(...args),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
}));

describe('proLicenseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('readProFromKeychain()', () => {
    it('returns false when no keychain entry exists', async () => {
      mockGetGenericPassword.mockResolvedValueOnce(false);
      expect(await readProFromKeychain()).toBe(false);
    });

    it('returns false when keychain entry has isPro=false', async () => {
      mockGetGenericPassword.mockResolvedValueOnce({ password: JSON.stringify({ isPro: false, verifiedAt: Date.now() }) });
      expect(await readProFromKeychain()).toBe(false);
    });

    it('returns true when keychain entry has isPro=true', async () => {
      mockGetGenericPassword.mockResolvedValueOnce({ password: JSON.stringify({ isPro: true, verifiedAt: Date.now() }) });
      expect(await readProFromKeychain()).toBe(true);
    });

    it('returns false when keychain entry is malformed', async () => {
      mockGetGenericPassword.mockResolvedValueOnce({ password: 'not-json' });
      expect(await readProFromKeychain()).toBe(false);
    });
  });

  describe('checkProStatus()', () => {
    it('returns the cached keychain value immediately', async () => {
      mockGetGenericPassword.mockResolvedValueOnce({ password: JSON.stringify({ isPro: true, verifiedAt: Date.now() }) });
      const result = await checkProStatus();
      expect(result).toBe(true);
    });

    it('returns false when keychain is empty', async () => {
      mockGetGenericPassword.mockResolvedValueOnce(false);
      const result = await checkProStatus();
      expect(result).toBe(false);
    });
  });
});
