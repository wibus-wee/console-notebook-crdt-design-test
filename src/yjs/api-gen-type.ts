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

