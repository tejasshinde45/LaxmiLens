import { InvalidDateRangeError } from '../errors/DomainErrors';

export class DateRange {
  public readonly startDate: Date;
  public readonly endDate: Date;

  constructor(startDate: Date, endDate: Date) {
    if (startDate.getTime() > endDate.getTime()) {
      throw new InvalidDateRangeError(startDate, endDate);
    }
    this.startDate = new Date(startDate.getTime());
    this.endDate = new Date(endDate.getTime());
    Object.freeze(this);
  }

  public contains(date: Date): boolean {
    const time = date.getTime();
    return time >= this.startDate.getTime() && time <= this.endDate.getTime();
  }

  public static thisMonth(): DateRange {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return new DateRange(start, end);
  }
}
