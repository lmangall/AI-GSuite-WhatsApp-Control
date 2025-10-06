import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { BraveSearchOptions, BraveSearchResult } from './brave.interface';
import { BRAVE_API_URL, BRAVE_API_KEY } from './brave.constants';

@Injectable()
export class BraveService {
  constructor(private readonly httpService: HttpService) {}

  async search(options: BraveSearchOptions): Promise<BraveSearchResult> {
    const params = new URLSearchParams({
      q: options.query,
      count: options.count?.toString() || '10',
      country: options.country || 'us',
      search_lang: options.search_lang || 'en',
    });

    try {
      const response = await this.httpService.axiosRef.get(`${BRAVE_API_URL}?${params}`, {
        headers: {
          'X-Subscription-Token': BRAVE_API_KEY,
        },
      });

      return response.data;
    } catch (error) {
      throw new HttpException(
        `Brave Search failed: ${error.response?.data?.message || error.message}`,
        error.response?.status || 500,
      );
    }
  }
}
