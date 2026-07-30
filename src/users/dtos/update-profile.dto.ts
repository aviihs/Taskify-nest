import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMobilePhone, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    avatar?: string;

    @ApiPropertyOptional({
        example: true,
    })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({
        example: 'Hi, my name is Shiva Bhusal.',
    })
    @IsOptional()
    bio?: string;

    @ApiPropertyOptional({
        example: 9812345678,
    })
    @IsOptional()
    @IsMobilePhone()
    phone?: number;
}