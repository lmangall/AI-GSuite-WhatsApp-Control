export interface BraveSearchOptions {
    query: string;
    count?: number;
    country?: string;
    search_lang?: string;
  }
  
  export interface BraveSearchResult {
    web: {
      results: {
        title: string;
        url: string;
        description: string;
      }[];
    };
  }
  