import { BadRequestException } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { KEY_PATTERN } from '@flagken/shared';

/** Checks project, environment, flag keys taken from the path. */
export class KeyPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!KEY_PATTERN.test(value)) throw new BadRequestException(`${value.slice(0, 80)} is not a valid key`);
    return value;
  }
}
