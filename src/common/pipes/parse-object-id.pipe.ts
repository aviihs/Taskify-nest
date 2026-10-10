import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

/** Rejects malformed ids at the edge with a 400 instead of a DB CastError. */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isValidObjectId(value) || !/^[a-f\d]{24}$/i.test(value)) {
      throw new BadRequestException(`Invalid id: ${value}`);
    }
    return value;
  }
}
