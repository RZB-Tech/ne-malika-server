import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { FilesService } from './files.service';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Public()
  @Get(':key')
  @ApiOperation({ summary: 'Получить файл из S3 по ключу' })
  @ApiParam({
    name: 'key',
    format: 'uuid',
    description: 'Ключ файла, полученный при создании presigned-ссылки',
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOkResponse({
    description: 'Файл успешно получен',
    content: {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
      'image/png': { schema: { type: 'string', format: 'binary' } },
      'image/webp': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 400, description: 'Ключ не является UUID v4' })
  @ApiResponse({ status: 404, description: 'Файл не найден' })
  async getFile(
    @Param('key', new ParseUUIDPipe({ version: '4' })) key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.filesService.getFile(key);
    const contentType = file.contentType ?? 'application/octet-stream';

    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Disposition', `inline; filename="${key}"`);
    response.setHeader(
      'Cache-Control',
      file.cacheControl ?? 'public, max-age=31536000, immutable',
    );

    if (file.contentLength !== undefined) {
      response.setHeader('Content-Length', file.contentLength.toString());
    }

    if (file.etag) {
      response.setHeader('ETag', file.etag);
    }

    if (file.lastModified) {
      response.setHeader('Last-Modified', file.lastModified.toUTCString());
    }

    return new StreamableFile(file.body);
  }
}
