import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SellerOnly } from '../../common/decorators/roles.decorator';
import { FilesService } from './files.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';

@ApiTags('files')
@ApiBearerAuth('access-token')
@SellerOnly()
@Controller('seller/uploads')
export class SellerFilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @ApiOperation({
    summary: 'Получить presigned-ссылку для прямой загрузки фото в S3',
  })
  @ApiResponse({ status: 201, type: UploadUrlResponseDto })
  createUploadUrl(@Body() dto: CreateUploadUrlDto) {
    return this.filesService.createUploadUrl(dto);
  }
}
