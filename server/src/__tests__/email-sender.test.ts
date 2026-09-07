import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  beginSend: vi.fn(),
  pollUntilDone: vi.fn(),
  stopPolling: vi.fn(),
}));
vi.mock('@azure/communication-email', () => ({
  EmailClient: class { beginSend = sdk.beginSend; },
}));
vi.mock('../config.js', () => ({
  getEmailConfig: () => ({
    senderAddress: 'sender@example.test',
    connectionString: 'unused-mocked-connection',
    appUrl: 'https://dashboard.example.test',
  }),
}));
import { EMAIL_SEND_TIMEOUT_MS, EmailSendTimeoutError, sendEmail } from '../lib/emailSender.js';

const params = { to: 'recipient@example.test', subject: 'בדיקה', html: '<p>בדיקה</p>', plainText: 'בדיקה' };
const poller = { pollUntilDone: sdk.pollUntilDone, stopPolling: sdk.stopPolling };
const pending = () => new Promise<never>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  sdk.beginSend.mockResolvedValue(poller);
  sdk.pollUntilDone.mockResolvedValue({ status: 'Succeeded' });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('bounded cancellable ACS sending (SDK entirely mocked)', () => {
  it('passes one shared abort signal through begin and polling, preserving the wire payload', async () => {
    const attachments = [{ name: 'header.jpg', contentType: 'image/jpeg', contentInBase64: 'test', contentId: 'header' }];
    await sendEmail({ ...params, attachments });
    expect(sdk.beginSend).toHaveBeenCalledWith({
      senderAddress: 'sender@example.test',
      content: { subject: params.subject, html: params.html, plainText: params.plainText },
      recipients: { to: [{ address: params.to }] }, attachments,
    }, { abortSignal: expect.any(AbortSignal) });
    const signal = sdk.beginSend.mock.calls[0][1].abortSignal as AbortSignal;
    expect(sdk.pollUntilDone).toHaveBeenCalledWith({ abortSignal: signal });
    expect(signal.aborted).toBe(false);
    expect(sdk.stopPolling).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('continues omitting attachments when the caller supplied none', async () => {
    await sendEmail(params);
    expect(sdk.beginSend.mock.calls[0][0]).not.toHaveProperty('attachments');
  });

  it.each(['Failed', 'Canceled', 'Running'])('never marks an ACS %s outcome as sent', async (status) => {
    sdk.pollUntilDone.mockResolvedValue({ status, error: { message: 'provider-detail' } });
    await expect(sendEmail(params)).rejects.toThrow(`ACS email send did not succeed (status: ${status}): provider-detail`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates begin-send failure and clears its timer without starting polling', async () => {
    const error = new Error('begin failed');
    sdk.beginSend.mockRejectedValue(error);
    await expect(sendEmail(params)).rejects.toBe(error);
    expect(sdk.pollUntilDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a polling failure and clears the deadline timer', async () => {
    const error = new Error('poll failed');
    sdk.pollUntilDone.mockRejectedValue(error);
    await expect(sendEmail(params)).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a beginSend that never resolves, even if the SDK ignores its abort signal', async () => {
    sdk.beginSend.mockImplementation(pending);
    const delivery = sendEmail(params).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    const error = await delivery;
    expect(error).toBeInstanceOf(EmailSendTimeoutError);
    expect(error).toMatchObject({ code: 'EMAIL_SEND_TIMEOUT' });
    expect((error as Error).message).toContain('delivery outcome is unknown');
    expect(sdk.beginSend.mock.calls[0][1].abortSignal.aborted).toBe(true);
    expect(sdk.pollUntilDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an unresponsive poller, cancels the SDK signal and stops local polling', async () => {
    sdk.pollUntilDone.mockImplementation(pending);
    const delivery = sendEmail(params).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS - 1);
    expect(sdk.stopPolling).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await delivery).toBeInstanceOf(EmailSendTimeoutError);
    const signal = sdk.pollUntilDone.mock.calls[0][0].abortSignal as AbortSignal;
    expect(signal).toBe(sdk.beginSend.mock.calls[0][1].abortSignal);
    expect(signal.aborted).toBe(true);
    expect(sdk.stopPolling).toHaveBeenCalledTimes(1);
  });

  it('applies a single total budget, not separate begin-send and poll budgets', async () => {
    let begin!: (value: typeof poller) => void;
    sdk.beginSend.mockImplementation(() => new Promise((resolve) => { begin = resolve; }));
    sdk.pollUntilDone.mockImplementation(pending);
    const delivery = sendEmail(params).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(40_000);
    begin(poller);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(sdk.pollUntilDone).toHaveBeenCalledTimes(1);
    expect(sdk.stopPolling).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await delivery).toBeInstanceOf(EmailSendTimeoutError);
  });

  it('does not start polling if beginSend resolves only after its caller timed out', async () => {
    let begin!: (value: typeof poller) => void;
    sdk.beginSend.mockImplementation(() => new Promise((resolve) => { begin = resolve; }));
    const delivery = sendEmail(params).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    expect(await delivery).toBeInstanceOf(EmailSendTimeoutError);
    begin(poller);
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.pollUntilDone).not.toHaveBeenCalled();
    expect(sdk.stopPolling).toHaveBeenCalledTimes(1);
  });

  it('does not turn a late provider success into caller success after timeout', async () => {
    let finish!: (value: { status: string }) => void;
    sdk.pollUntilDone.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const delivery = sendEmail(params).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    const result = await delivery;
    finish({ status: 'Succeeded' });
    await vi.advanceTimersByTimeAsync(0);
    expect(await delivery).toBe(result);
    expect(result).toBeInstanceOf(EmailSendTimeoutError);
  });

  it('uses an independent deadline/controller for the next message after timeout', async () => {
    sdk.pollUntilDone.mockImplementationOnce(pending);
    const first = sendEmail(params).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    expect(await first).toBeInstanceOf(EmailSendTimeoutError);
    await expect(sendEmail(params)).resolves.toBeUndefined();
    const firstSignal = sdk.beginSend.mock.calls[0][1].abortSignal;
    const secondSignal = sdk.beginSend.mock.calls[1][1].abortSignal;
    expect(secondSignal).not.toBe(firstSignal);
    expect(secondSignal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes an abort-aware SDK rejection into the explicit deadline error', async () => {
    sdk.pollUntilDone.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true }))
    );
    const delivery = sendEmail(params).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    expect(await delivery).toBeInstanceOf(EmailSendTimeoutError);
  });

  it('preserves the timeout even if SDK stopPolling itself throws', async () => {
    sdk.pollUntilDone.mockImplementation(pending);
    sdk.stopPolling.mockImplementation(() => { throw new Error('stop failed'); });
    const delivery = sendEmail(params).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    expect(await delivery).toBeInstanceOf(EmailSendTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });
});
