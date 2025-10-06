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

    this.logger.log(`🌐 [BraveService] ⏰ [HTTP 1/3] Starting search request`);
    this.logger.log(`🌐 [BraveService] Query: "${options.query}"`);
    this.logger.log(`🌐 [BraveService] API Key configured: ${BRAVE_API_KEY && BRAVE_API_KEY !== '<YOUR_API_KEY_HERE>' ? 'Yes (length: ' + BRAVE_API_KEY.length + ')' : 'NO - MISSING!'}`);

    try {
      this.logger.log(`🌐 [BraveService] ⏰ [HTTP 2/3] Making HTTP GET request (4s timeout)...`);
      this.logger.log(`🌐 [BraveService] Full URL: ${BRAVE_API_URL}?${params.toString()}`);
      
      const response = await this.httpService.axiosRef.get(`${BRAVE_API_URL}?${params.toString()}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_API_KEY,
        },
        timeout: 4000, // 4 second timeout for HTTP request
      });
      this.logger.log(`🌐 [BraveService] ✅ [HTTP 3/3] HTTP request completed`);

      const duration = Date.now() - startTime;
      this.logger.log(`✅ [BraveService] Search successful in ${duration}ms, results: ${response.data?.web?.results?.length || 0}`);

      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ [BraveService] ❌ [HTTP FAILED] Search failed after ${duration}ms`);
      this.logger.error(`❌ [BraveService] Error code: ${error.code}`);
      this.logger.error(`❌ [BraveService] Error message: ${error.message}`);
      
      if (error.response) {
        this.logger.error(`❌ [BraveService] Response status: ${error.response.status}`);
        this.logger.error(`❌ [BraveService] Response data: ${JSON.stringify(error.response.data)}`);
      } else {
        this.logger.error(`❌ [BraveService] No response received (network error or timeout)`);
      }
      
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        this.logger.error(`❌ [BraveService] HTTP request timed out after 4 seconds`);
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
