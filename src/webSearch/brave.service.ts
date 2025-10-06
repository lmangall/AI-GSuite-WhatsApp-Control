import { Injectable, HttpException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { BraveSearchOptions, BraveSearchResult } from './brave.interface';
import { BRAVE_API_URL, BRAVE_API_KEY } from './brave.constants';

@Injectable()
export class BraveService {
  private readonly logger = new Logger(BraveService.name);

  constructor(private readonly httpService: HttpService) {}

  async search(options: BraveSearchOptions): Promise<BraveSearchResult> {
    const startTime = Date.now();
    const params = new URLSearchParams({
      q: options.query,
      count: options.count?.toString() || '10',
      country: options.country || 'us',
      search_lang: options.search_lang || 'en',
    });

    this.logger.debug(`🌐 [BraveService] Starting search request`);
    this.logger.debug(`🌐 [BraveService] Query: "${options.query}"`);
    this.logger.debug(`🌐 [BraveService] URL: ${BRAVE_API_URL}?${params}`);
    this.logger.debug(`🌐 [BraveService] API Key configured: ${BRAVE_API_KEY ? 'Yes' : 'No'}`);

    try {
      this.logger.debug(`🌐 [BraveService] Making HTTP GET request...`);
      const response = await this.httpService.axiosRef.get(`${BRAVE_API_URL}?${params}`, {
        headers: {
          'X-Subscription-Token': BRAVE_API_KEY,
        },
        timeout: 8000, // 8 second timeout for HTTP request
      });

      const duration = Date.now() - startTime;
      this.logger.log(`✅ [BraveService] Search successful in ${duration}ms`);
      this.logger.debug(`🌐 [BraveService] Response status: ${response.status}`);
      this.logger.debug(`🌐 [BraveService] Response data keys: ${JSON.stringify(Object.keys(response.data || {}))}`);

      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ [BraveService] Search failed after ${duration}ms`);
      this.logger.error(`❌ [BraveService] Error code: ${error.code}`);
      this.logger.error(`❌ [BraveService] Error message: ${error.message}`);
      this.logger.error(`❌ [BraveService] Response status: ${error.response?.status}`);
      this.logger.error(`❌ [BraveService] Response data: ${JSON.stringify(error.response?.data)}`);
      
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        throw new HttpException(
          'Brave Search request timed out. Please try again.',
          408,
        );
      }
      throw new HttpException(
        `Brave Search failed: ${error.response?.data?.message || error.message}`,
        error.response?.status || 500,
      );
    }
  }
}
