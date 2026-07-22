import { ExponentialBackoff, ExponentialBackoffWithJitter, FixedDelay } from './strategies';

describe('FixedDelay', () => {
  test('should always return the same delay regardless of attempt', () => {
    const strategy = new FixedDelay(500);

    expect(strategy.getDelay(1)).toBe(500);
    expect(strategy.getDelay(2)).toBe(500);
    expect(strategy.getDelay(10)).toBe(500);
  });
});

describe('ExponentialBackoff', () => {
  test('should grow exponentially with the attempt number', () => {
    const strategy = new ExponentialBackoff(100, 2, 30_000);

    expect(strategy.getDelay(1)).toBe(100);
    expect(strategy.getDelay(2)).toBe(200);
    expect(strategy.getDelay(3)).toBe(400);
    expect(strategy.getDelay(4)).toBe(800);
  });

  test('should cap the delay at maxMs', () => {
    const strategy = new ExponentialBackoff(100, 2, 300);

    expect(strategy.getDelay(1)).toBe(100);
    expect(strategy.getDelay(2)).toBe(200);
    expect(strategy.getDelay(3)).toBe(300);
    expect(strategy.getDelay(10)).toBe(300);
  });

  test('should use default base/factor/max when not provided', () => {
    const strategy = new ExponentialBackoff();

    expect(strategy.getDelay(1)).toBe(200);
    expect(strategy.getDelay(2)).toBe(400);
  });
});

describe('ExponentialBackoffWithJitter', () => {
  test('should return a delay between 0 and the exponential cap', () => {
    const strategy = new ExponentialBackoffWithJitter(100, 2, 30_000);
    const randomSpy = jest.spyOn(Math, 'random');

    randomSpy.mockReturnValue(0);
    expect(strategy.getDelay(3)).toBe(0);

    randomSpy.mockReturnValue(1);
    expect(strategy.getDelay(3)).toBe(400); // cap for attempt 3 = 100 * 2^2

    randomSpy.mockReturnValue(0.5);
    expect(strategy.getDelay(1)).toBe(50); // cap for attempt 1 = 100

    randomSpy.mockRestore();
  });

  test('should cap the exponential ceiling at maxMs before applying jitter', () => {
    const strategy = new ExponentialBackoffWithJitter(100, 2, 150);
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(1);

    expect(strategy.getDelay(10)).toBe(150);

    randomSpy.mockRestore();
  });
});
