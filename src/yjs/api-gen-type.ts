export type DatabaseConnectInfo = {
  /**
   * Name of the database
   */
  name: string;
  /**
   * ID of the cluster this database belongs to
   */
  clusterID: number;
  /**
   * Database username
   */
  username: string;
  /**
   * Database password (optional)
   */
  password?: string;
  /**
   * Database name
   */
  database: string;
};

export type Column = {
  /**
   * Name of the column
   */
  name: string;
  /**
   * Data type of the column
   */
  type: string;
  /**
   * Whether the column is a primary key
   */
  isPrimaryKey: boolean;
  /**
   * Whether the column is hidden
   */
  isHidden: boolean;
};



export type QueryResponse = {
  columns: Array<Column>;
  rows: Array<Record<string, any>>;
  /**
   * Number of rows affected by the query
   */
  rowsAffected: number;
  /**
   * Error message if the query failed
   */
  error?: string;
};


